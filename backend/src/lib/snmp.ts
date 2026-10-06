import * as snmp from 'net-snmp';
import { logger } from './logger';
import { env } from './env';

export type VarBind = snmp.VarBind;

export interface SnmpCredentials {
  ip: string;
  port?: number;
  version: 'v1' | 'v2c' | 'v3';
  community?: string | null;
  v3User?: string | null;
  v3AuthProto?: string | null;
  v3AuthPass?: string | null;
  v3PrivProto?: string | null;
  v3PrivPass?: string | null;
}

const AUTH_PROTOCOLS: Record<string, number> = {
  MD5: snmp.AuthProtocols.md5,
  SHA: snmp.AuthProtocols.sha,
};

const PRIV_PROTOCOLS: Record<string, number> = {
  DES: snmp.PrivProtocols.des,
  AES: snmp.PrivProtocols.aes,
};

export function createSession(creds: SnmpCredentials): snmp.Session {
  const options = {
    port: creds.port ?? 161,
    retries: env.snmpRetries,
    timeout: env.snmpTimeoutMs,
    version: snmp.Version2c,
  };

  if (creds.version === 'v3') {
    const user = {
      name: creds.v3User ?? '',
      level: creds.v3PrivPass
        ? snmp.SecurityLevel.authPriv
        : creds.v3AuthPass
          ? snmp.SecurityLevel.authNoPriv
          : snmp.SecurityLevel.noAuthNoPriv,
      authProtocol: AUTH_PROTOCOLS[creds.v3AuthProto ?? 'SHA'] ?? snmp.AuthProtocols.sha,
      authKey: creds.v3AuthPass ?? undefined,
      privProtocol: PRIV_PROTOCOLS[creds.v3PrivProto ?? 'AES'] ?? snmp.PrivProtocols.aes,
      privKey: creds.v3PrivPass ?? undefined,
    };
    return snmp.createV3Session(creds.ip, user, {
      port: options.port,
      retries: options.retries,
      timeout: options.timeout,
    });
  }

  const version = creds.version === 'v1' ? snmp.Version1 : snmp.Version2c;
  return snmp.createSession(creds.ip, creds.community ?? 'public', { ...options, version });
}

export function snmpGet(session: snmp.Session, oids: string[]): Promise<snmp.VarBind[]> {
  return new Promise((resolve, reject) => {
    session.get(oids, (error: Error | null, varbinds: snmp.VarBind[]) => {
      if (error) return reject(error);
      resolve(varbinds);
    });
  });
}

/**
 * GETs a single OID and resolves `undefined` on ANY failure (transport error,
 * SNMPv1 noSuchName, SNMPv2 noSuchObject/noSuchInstance). Lets callers probe
 * optional/vendor OIDs individually so one missing OID never aborts a batch —
 * essential for SNMPv1 agents (e.g. many UPS cards) that fail the whole PDU when
 * a single requested OID is not implemented.
 */
export function snmpGetSingle(session: snmp.Session, oid: string): Promise<snmp.VarBind | undefined> {
  return new Promise((resolve) => {
    session.get([oid], (error: Error | null, varbinds: snmp.VarBind[]) => {
      if (error) return resolve(undefined);
      const vb = varbinds?.[0];
      if (!vb || snmp.isVarbindError(vb)) return resolve(undefined);
      resolve(vb);
    });
  });
}

/** Walks a column OID and returns a map of index -> value. */
export function snmpWalkColumn(session: snmp.Session, oid: string): Promise<Map<number, snmp.VarBind>> {
  const reps = [20, 5, 1];
  let attempt = 0;

  const run = (): Promise<Map<number, snmp.VarBind>> =>
    new Promise((resolve, reject) => {
      const result = new Map<number, snmp.VarBind>();
      function feedCb(varbinds: snmp.VarBind[]) {
        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) continue;
          const parts = vb.oid.split('.');
          const index = Number(parts[parts.length - 1]);
          result.set(index, vb);
        }
      }
      session.subtree(oid, reps[Math.min(attempt, reps.length - 1)], feedCb, (error: Error | null) => {
        if (!error) {
          resolve(result);
          return;
        }
        const isTimeout = /timed out/i.test(error.message);
        if (!isTimeout || attempt >= reps.length - 1) {
          reject(error);
          return;
        }
        attempt += 1;
        resolve(run());
      });
    });

  return run();
}

/**
 * Walks a column OID and keys results by the full instance suffix (the OID
 * remainder after the base). Required for tables with compound indexes such as
 * LLDP-MIB's lldpRemTable (timeMark.localPort.remIndex).
 */
export function snmpWalkSuffix(session: snmp.Session, oid: string): Promise<Map<string, snmp.VarBind>> {
  const reps = [20, 5, 1];
  let attempt = 0;

  const run = (): Promise<Map<string, snmp.VarBind>> =>
    new Promise((resolve, reject) => {
      const result = new Map<string, snmp.VarBind>();
      const base = oid.endsWith('.') ? oid : `${oid}.`;
      function feedCb(varbinds: snmp.VarBind[]) {
        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) continue;
          const suffix = vb.oid.startsWith(base) ? vb.oid.slice(base.length) : vb.oid;
          result.set(suffix, vb);
        }
      }
      session.subtree(oid, reps[Math.min(attempt, reps.length - 1)], feedCb, (error: Error | null) => {
        if (!error) {
          resolve(result);
          return;
        }
        const isTimeout = /timed out/i.test(error.message);
        if (!isTimeout || attempt >= reps.length - 1) {
          reject(error);
          return;
        }
        attempt += 1;
        resolve(run());
      });
    });

  return run();
}

export function varbindToString(vb: snmp.VarBind | undefined): string | undefined {
  if (!vb || vb.value === undefined || vb.value === null) return undefined;
  return Buffer.isBuffer(vb.value) ? vb.value.toString('utf8').replace(/\0/g, '') : String(vb.value);
}

export function varbindToNumber(vb: snmp.VarBind | undefined): number | undefined {
  if (!vb || vb.value === undefined || vb.value === null) return undefined;
  if (typeof vb.value === 'number') return vb.value;
  const parsed = Number(vb.value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function varbindToBigInt(vb: snmp.VarBind | undefined): bigint {
  if (!vb || vb.value === undefined || vb.value === null) return 0n;
  // net-snmp returns Counter64 (ifHCInOctets etc.) as an 8-byte big-endian Buffer.
  if (Buffer.isBuffer(vb.value)) {
    let result = 0n;
    for (const byte of vb.value) result = (result << 8n) | BigInt(byte);
    return result;
  }
  try {
    return BigInt(vb.value.toString());
  } catch {
    return 0n;
  }
}

export async function withSession<T>(creds: SnmpCredentials, fn: (session: snmp.Session) => Promise<T>): Promise<T> {
  const session = createSession(creds);
  try {
    return await fn(session);
  } catch (err) {
    logger.warn({ err, ip: creds.ip }, 'SNMP operation failed');
    throw err;
  } finally {
    session.close();
  }
}
