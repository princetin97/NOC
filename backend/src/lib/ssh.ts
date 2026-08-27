import { Client } from 'ssh2';
import { logger } from '../lib/logger';

export interface SshConfigTarget {
  ip: string;
  port: number;
  username: string;
  password: string;
  enablePassword?: string | null;
  vendor?: string | null;
}

// Vendor-specific command to dump the running configuration to stdout.
function configCommand(vendor?: string | null): string {
  const v = (vendor ?? '').toLowerCase();
  if (v.includes('mikrotik')) return '/export';
  if (v.includes('juniper')) return 'show configuration | display set | no-more';
  if (v.includes('fortinet')) return 'show full-configuration';
  // Cisco IOS/IOS-XE and most others.
  return 'terminal length 0\nshow running-config';
}

/**
 * Opens an interactive SSH shell, disables paging, runs the vendor config dump
 * command, and returns the captured output. Uses a shell (not exec) because most
 * network OSes reject non-interactive exec channels.
 */
export function fetchRunningConfig(target: SshConfigTarget): Promise<string> {
  const command = configCommand(target.vendor);

  return new Promise<string>((resolve, reject) => {
    const conn = new Client();
    let output = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      conn.end();
      reject(new Error('Hết thời gian chờ SSH (30s)'));
    }, 30_000);

    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      conn.end();
      if (err) reject(err);
      else resolve(sanitize(output));
    };

    conn
      .on('ready', () => {
        conn.shell((err, stream) => {
          if (err) return finish(err);
          stream
            .on('close', () => finish(null))
            .on('data', (data: Buffer) => {
              output += data.toString('utf8');
            });
          stream.stderr.on('data', () => { /* ignore banner noise */ });
          stream.write(`${command}\n`);
          // Give the device time to stream the config, then close the session.
          setTimeout(() => stream.end('exit\n'), 8_000);
        });
      })
      .on('error', (err) => finish(err))
      .connect({
        host: target.ip,
        port: target.port,
        username: target.username,
        password: target.password,
        readyTimeout: 15_000,
        algorithms: {
          // Broaden compatibility with older network OS SSH stacks.
          kex: ['diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1', 'diffie-hellman-group-exchange-sha256'],
          serverHostKey: ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256'],
          cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-cbc', '3des-cbc'],
        },
      });
  }).catch((err) => {
    logger.warn({ err, ip: target.ip }, 'SSH config fetch failed');
    throw err;
  });
}

// Trims the echoed command, pager artifacts and the trailing prompt.
function sanitize(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/--More--/g, '')
    .split('\n')
    .filter((line) => !/^\s*terminal length 0\s*$/.test(line))
    .join('\n')
    .trim();
}
