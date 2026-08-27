import https from 'https';
import http from 'http';
import { XMLParser } from 'fast-xml-parser';
import { logger } from './logger';

// Minimal hand-rolled client for the VMware vSphere Web Services API (vim25 SOAP),
// the same API pyVmomi/vmware_exporter/govc use to talk to vCenter. Only the calls
// needed to inventory ESXi hosts (+ their VMs/datastores) for monitoring are implemented.

export interface VSphereCredentials {
  endpoint: string; // e.g. https://vcenter.example.com
  username: string;
  password: string;
}

export interface VSphereHostInfo {
  externalId: string;
  name: string;
  connectionState?: string;
  powerState?: string;
  bootTime?: string;
  inMaintenanceMode?: boolean;
  overallStatus?: string;
  vendor?: string;
  model?: string;
  uuid?: string;
  cpuModel?: string;
  cpuMhz?: number;
  cpuCores?: number;
  cpuThreads?: number;
  memoryBytes?: number;
  numNics?: number;
  numHBAs?: number;
  overallCpuUsageMhz?: number;
  overallMemoryUsageMB?: number;
  productName?: string;
  productVersion?: string;
  dnsHostname?: string;
  dnsDomain?: string;
  defaultGateway?: string;
  pnics?: string[];
  managementIp?: string;
  datastoreRefs?: string[];
  vmRefs?: string[];
}

export interface VSphereDatastoreInfo {
  externalId: string;
  name: string;
  capacityBytes?: number;
  freeSpaceBytes?: number;
}

export interface VSphereVmInfo {
  externalId: string;
  name: string;
  powerState?: string;
  cpuCount?: number;
  memoryBytes?: number;
  guestOs?: string;
  ipAddress?: string;
  hostRef?: string;
}

export interface VSphereSession {
  endpoint: string;
  cookie: string;
  rootFolder: string;
  propertyCollector: string;
  sessionManager: string;
  agent: https.Agent | http.Agent;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['returnval', 'propSet', 'ManagedObjectReference', 'HostPhysicalNic', 'HostVirtualNic'].includes(name),
});

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function soapEnvelope(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Body>${inner}</soapenv:Body>
</soapenv:Envelope>`;
}

function firstMatchingKey(obj: unknown, suffix: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  return Object.keys(obj as Record<string, unknown>).find((k) => k === suffix || k.endsWith(`:${suffix}`));
}

// Text/attribute nodes from fast-xml-parser are either plain scalars or
// `{ '@_type': '...', '#text': 'value' }` objects — normalise to a string.
function textOf(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) return String((node as Record<string, unknown>)['#text']);
  return '';
}

function strOf(node: unknown): string | undefined {
  const t = textOf(node);
  return t === '' ? undefined : t;
}

function numOf(node: unknown): number | undefined {
  const t = textOf(node);
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function boolOf(node: unknown): boolean | undefined {
  const t = textOf(node);
  return t === '' ? undefined : t === 'true';
}

function toArray<T>(node: T | T[] | undefined): T[] {
  if (node === undefined || node === null) return [];
  return Array.isArray(node) ? node : [node];
}

function extractMoRefs(val: any): string[] {
  if (!val) return [];
  return toArray(val.ManagedObjectReference).map((item) => textOf(item)).filter(Boolean);
}

function extractPnicDeviceNames(val: any): string[] {
  if (!val) return [];
  return toArray(val.HostPhysicalNic)
    .map((item: any) => strOf(item?.device))
    .filter((d): d is string => Boolean(d));
}

// Prefer the management VMkernel adapter (vmk0 by convention) so the host has a
// reachable IP shown alongside the other synced Devices; falls back to whichever
// vnic reports first if vmk0 isn't found.
function extractManagementIp(val: any): string | undefined {
  if (!val) return undefined;
  const nics = toArray(val.HostVirtualNic);
  const managementNic = nics.find((n: any) => strOf(n?.device) === 'vmk0') ?? nics[0];
  return strOf(managementNic?.spec?.ip?.ipAddress);
}

function buildAgent(endpoint: string): https.Agent | http.Agent {
  // vCenter deployments overwhelmingly use internal/self-signed certificates, so
  // (like vmware_exporter's default `VSPHERE_IGNORE_SSL`) we don't verify the chain.
  return endpoint.startsWith('https:')
    ? new https.Agent({ rejectUnauthorized: false, keepAlive: true })
    : new http.Agent({ keepAlive: true });
}

function soapCall(endpoint: string, agent: https.Agent | http.Agent, body: string, cookie?: string): Promise<{ xml: string; cookie?: string }> {
  const url = new URL(`${endpoint}/sdk`);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        agent,
        timeout: 15_000,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const rawCookie = res.headers['set-cookie']?.[0];
          resolve({ xml: data, cookie: rawCookie?.split(';')[0] });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('vCenter request timed out (15s)')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseEnvelope(xml: string, context: string): any {
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new Error(`Phản hồi không hợp lệ từ vCenter (${context})`);
  }
  const envelopeKey = firstMatchingKey(doc, 'Envelope');
  const envelope = envelopeKey ? doc[envelopeKey] : undefined;
  const bodyKey = firstMatchingKey(envelope, 'Body');
  const body = bodyKey ? envelope[bodyKey] : undefined;
  if (!body) throw new Error(`Phản hồi không hợp lệ từ vCenter (${context})`);
  const faultKey = firstMatchingKey(body, 'Fault');
  if (faultKey) {
    const fault = body[faultKey];
    const msg = strOf(fault?.faultstring) ?? `vCenter SOAP fault (${context})`;
    throw new Error(msg);
  }
  return body;
}

async function retrieveServiceContent(endpoint: string, agent: https.Agent | http.Agent): Promise<{ rootFolder: string; propertyCollector: string; sessionManager: string }> {
  const body = soapEnvelope(
    '<RetrieveServiceContent xmlns="urn:vim25"><_this type="ServiceInstance">ServiceInstance</_this></RetrieveServiceContent>',
  );
  const { xml } = await soapCall(endpoint, agent, body);
  const respBody = parseEnvelope(xml, 'RetrieveServiceContent');
  const key = firstMatchingKey(respBody, 'RetrieveServiceContentResponse');
  // `returnval` is forced to always parse as an array (needed for RetrieveProperties,
  // which returns many of them) so normalise back to a single object here.
  const content = key ? toArray(respBody[key]?.returnval)[0] : undefined;
  if (!content) throw new Error('vCenter không trả về ServiceContent');
  return {
    rootFolder: textOf(content.rootFolder),
    propertyCollector: textOf(content.propertyCollector),
    sessionManager: textOf(content.sessionManager),
  };
}

async function login(endpoint: string, agent: https.Agent | http.Agent, sessionManager: string, username: string, password: string): Promise<string> {
  const body = soapEnvelope(
    `<Login xmlns="urn:vim25"><_this type="SessionManager">${sessionManager}</_this><userName>${escapeXml(username)}</userName><password>${escapeXml(password)}</password></Login>`,
  );
  const { xml, cookie } = await soapCall(endpoint, agent, body);
  parseEnvelope(xml, 'Login'); // throws with vCenter's own message on bad credentials
  if (!cookie) throw new Error('vCenter không trả về session cookie sau khi đăng nhập');
  return cookie;
}

export async function connect(creds: VSphereCredentials): Promise<VSphereSession> {
  const endpoint = creds.endpoint.replace(/\/+$/, '');
  const agent = buildAgent(endpoint);
  const content = await retrieveServiceContent(endpoint, agent);
  if (!content.sessionManager || !content.rootFolder || !content.propertyCollector) {
    agent.destroy();
    throw new Error('vCenter trả về ServiceContent không hợp lệ (thiếu sessionManager/rootFolder)');
  }
  const cookie = await login(endpoint, agent, content.sessionManager, creds.username, creds.password);
  return { endpoint, cookie, agent, ...content };
}

export async function disconnect(session: VSphereSession): Promise<void> {
  try {
    const body = soapEnvelope(`<Logout xmlns="urn:vim25"><_this type="SessionManager">${session.sessionManager}</_this></Logout>`);
    await soapCall(session.endpoint, session.agent, body, session.cookie);
  } catch (err) {
    logger.debug({ err }, 'vCenter logout failed (non-fatal)');
  } finally {
    session.agent.destroy();
  }
}

function toPropMap(raw: any): { moref: string; props: Record<string, unknown> } {
  const moref = textOf(raw.obj);
  const props: Record<string, unknown> = {};
  for (const p of toArray(raw.propSet)) {
    props[textOf(p.name)] = p.val;
  }
  return { moref, props };
}

// Standard vSphere "full inventory" traversal, scoped down to just the Folder ->
// Datacenter -> hostFolder -> ComputeResource -> HostSystem path (skips the
// resourcePool/vmFolder branches since we only need ESXi hosts here).
const HOST_TRAVERSAL = `
  <selectSet xsi:type="TraversalSpec">
    <name>visitFolders</name>
    <type>Folder</type>
    <path>childEntity</path>
    <skip>false</skip>
    <selectSet><name>visitFolders</name></selectSet>
    <selectSet><name>dcToHf</name></selectSet>
    <selectSet><name>crToH</name></selectSet>
  </selectSet>
  <selectSet xsi:type="TraversalSpec">
    <name>dcToHf</name>
    <type>Datacenter</type>
    <path>hostFolder</path>
    <skip>false</skip>
    <selectSet><name>visitFolders</name></selectSet>
  </selectSet>
  <selectSet xsi:type="TraversalSpec">
    <name>crToH</name>
    <type>ComputeResource</type>
    <path>host</path>
    <skip>false</skip>
  </selectSet>`;

async function retrievePropertiesRaw(session: VSphereSession, type: string, props: string[], objectSetInner: string): Promise<any[]> {
  const propSet = `<type>${type}</type>${props.map((p) => `<pathSet>${p}</pathSet>`).join('')}`;
  const body = soapEnvelope(
    `<RetrieveProperties xmlns="urn:vim25"><_this type="PropertyCollector">${session.propertyCollector}</_this><specSet><propSet>${propSet}</propSet>${objectSetInner}</specSet></RetrieveProperties>`,
  );
  const { xml } = await soapCall(session.endpoint, session.agent, body, session.cookie);
  const respBody = parseEnvelope(xml, 'RetrieveProperties');
  const key = firstMatchingKey(respBody, 'RetrievePropertiesResponse');
  const returnval = key ? respBody[key]?.returnval : undefined;
  return toArray(returnval);
}

export async function retrieveHosts(session: VSphereSession): Promise<VSphereHostInfo[]> {
  const props = [
    'name',
    'runtime.connectionState',
    'runtime.powerState',
    'runtime.bootTime',
    'runtime.inMaintenanceMode',
    'overallStatus',
    'summary.hardware.vendor',
    'summary.hardware.model',
    'summary.hardware.uuid',
    'summary.hardware.cpuModel',
    'summary.hardware.cpuMhz',
    'summary.hardware.numCpuCores',
    'summary.hardware.numCpuThreads',
    'summary.hardware.memorySize',
    'summary.hardware.numNics',
    'summary.hardware.numHBAs',
    'summary.quickStats.overallCpuUsage',
    'summary.quickStats.overallMemoryUsage',
    'config.product.name',
    'config.product.version',
    'config.network.dnsConfig.hostName',
    'config.network.dnsConfig.domainName',
    'config.network.ipRouteConfig.defaultGateway',
    'config.network.pnic',
    'config.network.vnic',
    'datastore',
    'vm',
  ];
  const objectSetInner = `<objectSet><obj type="Folder">${session.rootFolder}</obj><skip>true</skip>${HOST_TRAVERSAL}</objectSet>`;
  const raw = await retrievePropertiesRaw(session, 'HostSystem', props, objectSetInner);
  return raw.map((r) => {
    const { moref, props: p } = toPropMap(r);
    return {
      externalId: moref,
      name: strOf(p['name']) ?? moref,
      connectionState: strOf(p['runtime.connectionState']),
      powerState: strOf(p['runtime.powerState']),
      bootTime: strOf(p['runtime.bootTime']),
      inMaintenanceMode: boolOf(p['runtime.inMaintenanceMode']),
      overallStatus: strOf(p['overallStatus']),
      vendor: strOf(p['summary.hardware.vendor']),
      model: strOf(p['summary.hardware.model']),
      uuid: strOf(p['summary.hardware.uuid']),
      cpuModel: strOf(p['summary.hardware.cpuModel']),
      cpuMhz: numOf(p['summary.hardware.cpuMhz']),
      cpuCores: numOf(p['summary.hardware.numCpuCores']),
      cpuThreads: numOf(p['summary.hardware.numCpuThreads']),
      memoryBytes: numOf(p['summary.hardware.memorySize']),
      numNics: numOf(p['summary.hardware.numNics']),
      numHBAs: numOf(p['summary.hardware.numHBAs']),
      overallCpuUsageMhz: numOf(p['summary.quickStats.overallCpuUsage']),
      overallMemoryUsageMB: numOf(p['summary.quickStats.overallMemoryUsage']),
      productName: strOf(p['config.product.name']),
      productVersion: strOf(p['config.product.version']),
      dnsHostname: strOf(p['config.network.dnsConfig.hostName']),
      dnsDomain: strOf(p['config.network.dnsConfig.domainName']),
      defaultGateway: strOf(p['config.network.ipRouteConfig.defaultGateway']),
      pnics: extractPnicDeviceNames(p['config.network.pnic']),
      managementIp: extractManagementIp(p['config.network.vnic']),
      datastoreRefs: extractMoRefs(p['datastore']),
      vmRefs: extractMoRefs(p['vm']),
    };
  });
}

async function retrievePropertiesByRefs(session: VSphereSession, type: string, refs: string[], props: string[]): Promise<any[]> {
  if (refs.length === 0) return [];
  const objectSetInner = refs.map((ref) => `<objectSet><obj type="${type}">${ref}</obj><skip>false</skip></objectSet>`).join('');
  return retrievePropertiesRaw(session, type, props, objectSetInner);
}

export async function retrieveDatastores(session: VSphereSession, refs: string[]): Promise<VSphereDatastoreInfo[]> {
  const raw = await retrievePropertiesByRefs(session, 'Datastore', refs, ['name', 'summary.capacity', 'summary.freeSpace']);
  return raw.map((r) => {
    const { moref, props: p } = toPropMap(r);
    return {
      externalId: moref,
      name: strOf(p['name']) ?? moref,
      capacityBytes: numOf(p['summary.capacity']),
      freeSpaceBytes: numOf(p['summary.freeSpace']),
    };
  });
}

export async function retrieveVmsByRefs(session: VSphereSession, refs: string[]): Promise<VSphereVmInfo[]> {
  const raw = await retrievePropertiesByRefs(session, 'VirtualMachine', refs, [
    'name',
    'runtime.powerState',
    'config.hardware.numCPU',
    'config.hardware.memoryMB',
    'guest.guestFullName',
    'guest.ipAddress',
    'runtime.host',
  ]);
  return raw.map((r) => {
    const { moref, props: p } = toPropMap(r);
    const memoryMB = numOf(p['config.hardware.memoryMB']);
    return {
      externalId: moref,
      name: strOf(p['name']) ?? moref,
      powerState: strOf(p['runtime.powerState']),
      cpuCount: numOf(p['config.hardware.numCPU']),
      memoryBytes: memoryMB !== undefined ? memoryMB * 1024 * 1024 : undefined,
      guestOs: strOf(p['guest.guestFullName']),
      ipAddress: strOf(p['guest.ipAddress']),
      hostRef: strOf(p['runtime.host']),
    };
  });
}
