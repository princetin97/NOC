import 'dotenv/config';
import dgram from 'dgram';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { env } from '../lib/env';
import { publishEvent } from '../lib/events';

const SEVERITY_NAMES = ['emerg', 'alert', 'crit', 'error', 'warning', 'notice', 'info', 'debug'];

function parseSyslog(raw: string): { severity: string; message: string } {
  const match = raw.match(/^<(\d+)>(.*)$/s);
  if (!match) return { severity: 'info', message: raw };
  const pri = Number(match[1]);
  const severity = SEVERITY_NAMES[pri % 8] ?? 'info';
  return { severity, message: match[2].trim() };
}

const server = dgram.createSocket('udp4');

server.on('message', async (msg, rinfo) => {
  const raw = msg.toString('utf8');
  const { severity, message } = parseSyslog(raw);

  try {
    const device = await prisma.device.findFirst({ where: { ip: rinfo.address } });
    const event = await prisma.eventLog.create({
      data: {
        deviceId: device?.id,
        facility: 'syslog',
        severity,
        message,
        rawSource: rinfo.address,
      },
    });
    await publishEvent('event:new', event);
  } catch (err) {
    logger.error({ err }, 'Failed to store syslog message');
  }
});

server.on('error', (err) => {
  logger.error({ err }, 'Syslog UDP server error');
});

server.bind(env.syslogPort, '0.0.0.0', () => {
  logger.info(`Syslog UDP collector listening on port ${env.syslogPort}`);
});
