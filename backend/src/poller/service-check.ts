import dns from 'dns/promises';
import net from 'net';
import { prisma } from '../lib/db';
import { checkPing } from '../lib/ping';
import { publishEvent } from '../lib/events';
import { evaluateAlertsForService } from './alerting';

const DEFAULT_PORTS: Record<string, number> = { SSH: 22, MYSQL: 3306, BGP: 179, HTTP: 80, HTTPS: 443 };

function buildHttpUrl(type: 'HTTP' | 'HTTPS', target: string, port?: number | null): string {
  const normalized = target.trim();
  const hasScheme = /^https?:\/\//i.test(normalized);
  const base = hasScheme ? normalized : `${type === 'HTTPS' ? 'https' : 'http'}://${normalized}`;

  try {
    const url = new URL(base);
    if (port && Number.isInteger(port) && port > 0) {
      url.port = String(port);
    }
    return url.toString();
  } catch {
    return base;
  }
}

async function checkTcp(host: string, port: number, timeoutMs = 4000): Promise<{ up: boolean; ms: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (up: boolean) => {
      socket.destroy();
      resolve({ up, ms: Date.now() - start });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function checkHttp(url: string, timeoutMs = 5000): Promise<{ up: boolean; ms: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return { up: res.status < 500, ms: Date.now() - start };
  } catch {
    return { up: false, ms: Date.now() - start };
  }
}

async function checkDns(hostname: string): Promise<{ up: boolean; ms: number }> {
  const start = Date.now();
  try {
    await dns.lookup(hostname);
    return { up: true, ms: Date.now() - start };
  } catch {
    return { up: false, ms: Date.now() - start };
  }
}

/** Runs a single service check (HTTP/TCP/DNS/PING) and records the result. */
export async function runServiceCheck(serviceId: string): Promise<void> {
  const service = await prisma.serviceCheck.findUnique({ where: { id: serviceId } });
  if (!service || !service.enabled) return;

  let result: { up: boolean; ms: number };
  switch (service.type) {
    case 'HTTP':
      result = await checkHttp(buildHttpUrl('HTTP', service.target, service.port));
      break;
    case 'HTTPS':
      result = await checkHttp(buildHttpUrl('HTTPS', service.target, service.port));
      break;
    case 'DNS':
      result = await checkDns(service.target);
      break;
    case 'PING': {
      const ping = await checkPing(service.target);
      result = { up: ping.alive, ms: ping.latencyMs ?? 0 };
      break;
    }
    default: {
      const port = service.port ?? DEFAULT_PORTS[service.type] ?? 80;
      result = await checkTcp(service.target, port);
    }
  }

  const status = result.up ? 'up' : 'down';
  const history = await prisma.serviceCheckHistory.findMany({
    where: { serviceId },
    orderBy: { timestamp: 'desc' },
    take: 99,
  });
  const upCount = history.filter((h) => h.status === 'up').length + (result.up ? 1 : 0);
  const uptimePercent = (upCount / (history.length + 1)) * 100;

  await prisma.serviceCheck.update({
    where: { id: serviceId },
    data: { status, responseTimeMs: result.ms, uptimePercent, lastCheck: new Date() },
  });
  await prisma.serviceCheckHistory.create({
    data: { serviceId, status, responseTimeMs: result.ms },
  });

  await evaluateAlertsForService(serviceId);

  await publishEvent('service:updated', { serviceId, status, responseTimeMs: result.ms });
}
