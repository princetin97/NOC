import * as snmp from 'net-snmp';
import ping from 'ping';
import { OID } from './mib-oids';
import { logger } from './logger';

export interface ScanCredentials {
  version: 'v1' | 'v2c' | 'v3';
  community?: string | null;
  port?: number;
  v3User?: string | null;
  v3AuthProto?: string | null;
  v3AuthPass?: string | null;
  v3PrivProto?: string | null;
  v3PrivPass?: string | null;
}

export interface ScanResult {
  ip: string;
  sysName: string | null;
  sysDescr: string | null;
  pingAlive: boolean;
  snmpAlive: boolean;
  pingLatencyMs: number | null;
}

const AUTH_PROTOCOLS: Record<string, number> = { MD5: snmp.AuthProtocols.md5, SHA: snmp.AuthProtocols.sha };
const PRIV_PROTOCOLS: Record<string, number> = { DES: snmp.PrivProtocols.des, AES: snmp.PrivProtocols.aes };

// Max hosts we are willing to probe in one scan (guards against huge ranges).
const MAX_HOSTS = 1024;
const PROBE_TIMEOUT_MS = 800;
const MIN_CONCURRENCY = 24;
const MAX_CONCURRENCY = 192;
const TARGET_SCAN_MS = 7000;

function ipToInt(ip: string): number {
  const parts = ip.trim().split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** Expands an IPv4 CIDR (e.g. 192.168.1.0/24) into its usable host addresses. */
export function enumerateHosts(cidr: string): string[] {
  const [base, prefixStr] = cidr.trim().split('/');
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 32) {
    throw new Error('Prefix phải nằm trong khoảng /8 đến /32');
  }
  const baseInt = ipToInt(base);
  const hostBits = 32 - prefix;
  const size = hostBits === 0 ? 1 : 2 ** hostBits;
  if (size > MAX_HOSTS + 2) {
    throw new Error(`Dải mạng quá lớn (tối đa ${MAX_HOSTS} địa chỉ). Hãy dùng prefix nhỏ hơn.`);
  }
  const network = baseInt & (hostBits === 32 ? 0xffffffff : (0xffffffff << hostBits) >>> 0);
  const hosts: string[] = [];
  if (prefix >= 31) {
    for (let i = 0; i < size; i++) hosts.push(intToIp(network + i));
  } else {
    // Skip network + broadcast addresses.
    for (let i = 1; i < size - 1; i++) hosts.push(intToIp(network + i));
  }
  return hosts;
}

function buildSession(ip: string, creds: ScanCredentials): snmp.Session {
  const port = creds.port ?? 161;
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
    return snmp.createV3Session(ip, user, { port, retries: 0, timeout: PROBE_TIMEOUT_MS });
  }
  const version = creds.version === 'v1' ? snmp.Version1 : snmp.Version2c;
  return snmp.createSession(ip, creds.community ?? 'public', { port, retries: 0, timeout: PROBE_TIMEOUT_MS, version });
}

function pingProbe(ip: string): Promise<{ alive: boolean; latencyMs: number | null }> {
  return ping.promise
    .probe(ip, { timeout: 1 })
    .then((res) => {
      const time = typeof res.time === 'number' ? res.time : null;
      return { alive: !!res.alive, latencyMs: time };
    })
    .catch(() => ({ alive: false, latencyMs: null }));
}

function snmpProbe(ip: string, creds: ScanCredentials): Promise<{ alive: boolean; sysName: string | null; sysDescr: string | null }> {
  return new Promise((resolve) => {
    let session: snmp.Session;
    try {
      session = buildSession(ip, creds);
    } catch {
      resolve({ alive: false, sysName: null, sysDescr: null });
      return;
    }
    let settled = false;
    const done = (result: { alive: boolean; sysName: string | null; sysDescr: string | null }) => {
      if (settled) return;
      settled = true;
      try {
        session.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    try {
      session.get([OID.sysDescr, OID.sysName], (error: Error | null, varbinds: snmp.VarBind[]) => {
        if (error || !varbinds || varbinds.length === 0) {
          done({ alive: false, sysName: null, sysDescr: null });
          return;
        }
        const value = (vb: snmp.VarBind | undefined): string | null => {
          if (!vb || snmp.isVarbindError(vb)) return null;
          const v = vb.value;
          return Buffer.isBuffer(v) ? v.toString('utf8') : v != null ? String(v) : null;
        };
        const sysDescr = value(varbinds[0]);
        const sysName = value(varbinds[1]);
        if (!sysDescr && !sysName) {
          done({ alive: false, sysName: null, sysDescr: null });
          return;
        }
        done({ alive: true, sysDescr, sysName });
      });
    } catch {
      done({ alive: false, sysName: null, sysDescr: null });
    }
    // Safety timeout in case the callback never fires.
    setTimeout(() => done({ alive: false, sysName: null, sysDescr: null }), PROBE_TIMEOUT_MS + 400);
  });
}

/** Probes every host in the CIDR with SNMP and returns the ones that respond. */
export async function scanSubnet(cidr: string, creds: ScanCredentials): Promise<ScanResult[]> {
  const hosts = enumerateHosts(cidr);
  const found: ScanResult[] = [];
  let index = 0;

  const workersCount = Math.min(
    hosts.length,
    Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, Math.ceil((hosts.length * PROBE_TIMEOUT_MS) / TARGET_SCAN_MS))),
  );

  async function worker(): Promise<void> {
    while (index < hosts.length) {
      const ip = hosts[index++];
      const [pingResult, snmpResult] = await Promise.all([pingProbe(ip), snmpProbe(ip, creds)]);
      if (!pingResult.alive && !snmpResult.alive) continue;
      found.push({
        ip,
        sysName: snmpResult.sysName,
        sysDescr: snmpResult.sysDescr,
        pingAlive: pingResult.alive,
        snmpAlive: snmpResult.alive,
        pingLatencyMs: pingResult.latencyMs,
      });
    }
  }

  const workers = Array.from({ length: workersCount }, () => worker());
  await Promise.all(workers);
  logger.info({ cidr, scanned: hosts.length, found: found.length, workers: workersCount }, 'subnet scan complete');
  found.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip));
  return found;
}
