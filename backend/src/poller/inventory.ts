import { prisma } from '../lib/db';
import { OID } from '../lib/mib-oids';
import { logger } from '../lib/logger';
import { snmpWalkColumn, varbindToNumber, varbindToString, type VarBind } from '../lib/snmp';

type HealthStatus = 'ok' | 'warning' | 'critical' | 'unknown';

function decodeEntityClass(code: number | undefined): string {
  switch (code) {
    case 1: return 'other';
    case 2: return 'unknown';
    case 3: return 'chassis';
    case 4: return 'backplane';
    case 5: return 'container';
    case 6: return 'powerSupply';
    case 7: return 'fan';
    case 8: return 'sensor';
    case 9: return 'module';
    case 10: return 'port';
    case 11: return 'stack';
    case 12: return 'cpu';
    default: return 'component';
  }
}

function decodeOperStatus(code: number | undefined): string | undefined {
  switch (code) {
    case 1: return 'unknown';
    case 2: return 'disabled';
    case 3: return 'enabling';
    case 4: return 'enabled';
    case 5: return 'disabling';
    case 6: return 'notPresent';
    case 7: return 'failed';
    default: return undefined;
  }
}

function decodeAdminStatus(code: number | undefined): string | undefined {
  switch (code) {
    case 1: return 'unknown';
    case 2: return 'locked';
    case 3: return 'shuttingDown';
    case 4: return 'unlocked';
    case 5: return 'testing';
    default: return undefined;
  }
}

function decodeAlarmStatus(code: number | undefined): string | undefined {
  switch (code) {
    case 1: return 'unknown';
    case 2: return 'underRepair';
    case 3: return 'critical';
    case 4: return 'major';
    case 5: return 'minor';
    case 6: return 'warning';
    case 7: return 'indeterminate';
    default: return undefined;
  }
}

function componentHealth(operStatus: string | undefined, alarmStatus: string | undefined): HealthStatus {
  if (operStatus === 'failed') return 'critical';
  if (operStatus === 'notPresent' || operStatus === 'disabled' || operStatus === 'disabling') return 'warning';
  if (alarmStatus === 'critical' || alarmStatus === 'major') return 'critical';
  if (alarmStatus === 'minor' || alarmStatus === 'warning' || alarmStatus === 'underRepair') return 'warning';
  if (operStatus === 'enabled') return 'ok';
  return 'unknown';
}

async function walkSafe(session: Parameters<typeof snmpWalkColumn>[0], oid: string): Promise<Map<number, VarBind>> {
  try {
    return await snmpWalkColumn(session, oid);
  } catch {
    return new Map<number, VarBind>();
  }
}

function componentLabel(input: {
  name: string;
  description: string;
  model: string | null;
  entityIndex: number;
}): string {
  return input.name || input.description || input.model || `Entity ${input.entityIndex}`;
}

async function syncHardwareAlerts(deviceId: string, components: Array<{
  entityIndex: number;
  class: string;
  name: string;
  description: string;
  model: string | null;
  operStatus: string | undefined;
  alarmStatus: string | undefined;
  healthStatus: HealthStatus;
}>): Promise<void> {
  const issues = components.filter((c) => c.healthStatus === 'warning' || c.healthStatus === 'critical');
  const issueByKey = new Map<string, (typeof issues)[number]>();
  for (const issue of issues) issueByKey.set(`HW-ENTITY-${issue.entityIndex}`, issue);

  const openAlerts = await prisma.alert.findMany({
    where: {
      deviceId,
      serviceId: null,
      ruleId: null,
      interfaceName: { startsWith: 'HW-ENTITY-' },
      status: { in: ['active', 'acknowledged'] },
    },
  });
  const openByKey = new Map<string, typeof openAlerts[number]>();
  for (const a of openAlerts) {
    if (a.interfaceName) openByKey.set(a.interfaceName, a);
  }

  for (const [key, issue] of issueByKey) {
    const label = componentLabel(issue);
    const message = `Hardware issue [${issue.class}] ${label}: oper=${issue.operStatus ?? 'unknown'}, alarm=${issue.alarmStatus ?? 'unknown'}`;
    const severity = issue.healthStatus === 'critical' ? 'critical' : 'high';
    const existing = openByKey.get(key);

    if (existing) {
      await prisma.alert.update({
        where: { id: existing.id },
        data: {
          message,
          severity,
          // Keep acknowledged state if operators already handled it.
          status: existing.status === 'acknowledged' ? 'acknowledged' : 'active',
          resolvedAt: null,
          timestamp: new Date(),
        },
      });
    } else {
      await prisma.alert.create({
        data: {
          deviceId,
          interfaceName: key,
          message,
          severity,
          status: 'active',
          timestamp: new Date(),
        },
      });
    }
  }

  for (const existing of openAlerts) {
    if (!existing.interfaceName) continue;
    if (issueByKey.has(existing.interfaceName)) continue;
    await prisma.alert.update({
      where: { id: existing.id },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
  }
}

/**
 * Discovers hardware inventory components from ENTITY-MIB and tracks component health.
 */
export async function discoverHardwareInventory(session: Parameters<typeof snmpWalkColumn>[0], deviceId: string): Promise<void> {
  const [
    names,
    descrs,
    classes,
    parents,
    models,
    serials,
    hardwareRevs,
    softwareRevs,
    isFrus,
    stateOper,
    stateAdmin,
    stateAlarm,
  ] = await Promise.all([
    walkSafe(session, OID.entPhysicalName),
    walkSafe(session, OID.entPhysicalDescr),
    walkSafe(session, OID.entPhysicalClass),
    walkSafe(session, OID.entPhysicalContainedIn),
    walkSafe(session, OID.entPhysicalModelName),
    walkSafe(session, OID.entPhysicalSerialNum),
    walkSafe(session, OID.entPhysicalHardwareRev),
    walkSafe(session, OID.entPhysicalSoftwareRev),
    walkSafe(session, OID.entPhysicalIsFru),
    walkSafe(session, OID.entStateOper),
    walkSafe(session, OID.entStateAdmin),
    walkSafe(session, OID.entStateAlarm),
  ]);

  const indexes = new Set<number>([
    ...names.keys(),
    ...descrs.keys(),
    ...classes.keys(),
    ...models.keys(),
    ...serials.keys(),
  ]);

  if (indexes.size === 0) {
    return;
  }

  const now = new Date();
  const upserts: ReturnType<typeof prisma.hardwareComponent.upsert>[] = [];
  const componentSummaries: Array<{
    entityIndex: number;
    class: string;
    name: string;
    description: string;
    model: string | null;
    operStatus: string | undefined;
    alarmStatus: string | undefined;
    healthStatus: HealthStatus;
  }> = [];

  for (const entityIndex of indexes) {
    const name = varbindToString(names.get(entityIndex)) ?? '';
    const description = varbindToString(descrs.get(entityIndex)) ?? '';
    const model = varbindToString(models.get(entityIndex));
    const serial = varbindToString(serials.get(entityIndex));

    if (!name && !description && !model && !serial) continue;

    const parentEntityIndex = varbindToNumber(parents.get(entityIndex)) ?? null;
    const classCode = varbindToNumber(classes.get(entityIndex));
    const componentClass = decodeEntityClass(classCode);

    const operStatus = decodeOperStatus(varbindToNumber(stateOper.get(entityIndex)));
    const adminStatus = decodeAdminStatus(varbindToNumber(stateAdmin.get(entityIndex)));
    const alarmStatus = decodeAlarmStatus(varbindToNumber(stateAlarm.get(entityIndex)));
    const healthStatus = componentHealth(operStatus, alarmStatus);

    componentSummaries.push({
      entityIndex,
      class: componentClass,
      name,
      description,
      model: model ?? null,
      operStatus,
      alarmStatus,
      healthStatus,
    });

    upserts.push(
      prisma.hardwareComponent.upsert({
        where: { deviceId_entityIndex: { deviceId, entityIndex } },
        create: {
          deviceId,
          entityIndex,
          parentEntityIndex,
          name: name || description || model || `Entity ${entityIndex}`,
          description,
          class: componentClass,
          model,
          serial,
          hardwareRev: varbindToString(hardwareRevs.get(entityIndex)) ?? undefined,
          softwareRev: varbindToString(softwareRevs.get(entityIndex)) ?? undefined,
          isFru: (varbindToNumber(isFrus.get(entityIndex)) ?? 2) === 1,
          operStatus,
          adminStatus,
          alarmStatus,
          healthStatus,
          updatedAt: now,
        },
        update: {
          parentEntityIndex,
          name: name || description || model || `Entity ${entityIndex}`,
          description,
          class: componentClass,
          model,
          serial,
          hardwareRev: varbindToString(hardwareRevs.get(entityIndex)) ?? undefined,
          softwareRev: varbindToString(softwareRevs.get(entityIndex)) ?? undefined,
          isFru: (varbindToNumber(isFrus.get(entityIndex)) ?? 2) === 1,
          operStatus,
          adminStatus,
          alarmStatus,
          healthStatus,
          updatedAt: now,
        },
      }),
    );
  }

  if (upserts.length === 0) return;

  await prisma.$transaction(upserts);
  await prisma.hardwareComponent.deleteMany({
    where: {
      deviceId,
      updatedAt: { lt: now },
    },
  });

  try {
    await syncHardwareAlerts(deviceId, componentSummaries);
  } catch (err) {
    logger.warn({ err, deviceId }, 'Hardware inventory alert synchronization failed');
  }
}
