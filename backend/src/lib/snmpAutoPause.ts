import { redisConnection } from './queue';
import { env } from './env';

const STREAK_KEY_PREFIX = 'snmp:timeout-streak:';
const PAUSED_KEY_PREFIX = 'snmp:auto-paused:';
const PAUSED_PROBE_LOCK_KEY_PREFIX = 'snmp:auto-paused:probe-lock:';
const STREAK_TTL_SECONDS = 24 * 60 * 60;

function streakKey(deviceId: string): string {
  return `${STREAK_KEY_PREFIX}${deviceId}`;
}

function pausedKey(deviceId: string): string {
  return `${PAUSED_KEY_PREFIX}${deviceId}`;
}

function pausedProbeLockKey(deviceId: string): string {
  return `${PAUSED_PROBE_LOCK_KEY_PREFIX}${deviceId}`;
}

export interface SnmpAutoPauseState {
  paused: boolean;
  pausedAt: string | null;
}

function parsePausedAt(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { pausedAt?: unknown };
    return typeof parsed.pausedAt === 'string' ? parsed.pausedAt : null;
  } catch {
    return null;
  }
}

export async function isSnmpAutoPaused(deviceId: string): Promise<boolean> {
  if (!env.snmpAutoPauseEnabled) return false;
  const raw = await redisConnection.get(pausedKey(deviceId));
  return !!raw;
}

export async function getSnmpAutoPauseState(deviceId: string): Promise<SnmpAutoPauseState> {
  if (!env.snmpAutoPauseEnabled) return { paused: false, pausedAt: null };
  const raw = await redisConnection.get(pausedKey(deviceId));
  if (!raw) return { paused: false, pausedAt: null };
  return { paused: true, pausedAt: parsePausedAt(raw) };
}

export async function getSnmpAutoPauseStateMap(deviceIds: string[]): Promise<Map<string, SnmpAutoPauseState>> {
  const map = new Map<string, SnmpAutoPauseState>();
  for (const id of deviceIds) map.set(id, { paused: false, pausedAt: null });
  if (!env.snmpAutoPauseEnabled || deviceIds.length === 0) return map;

  const keys = deviceIds.map((id) => pausedKey(id));
  const values = await redisConnection.mget(...keys);
  for (let i = 0; i < deviceIds.length; i += 1) {
    const raw = values[i] ?? null;
    map.set(deviceIds[i], { paused: !!raw, pausedAt: parsePausedAt(raw) });
  }
  return map;
}

export async function recordSnmpTimeoutFailure(deviceId: string): Promise<{ streak: number; paused: boolean }> {
  if (!env.snmpAutoPauseEnabled) return { streak: 0, paused: false };

  const key = streakKey(deviceId);
  const streak = await redisConnection.incr(key);
  await redisConnection.expire(key, STREAK_TTL_SECONDS);

  if (streak < env.snmpAutoPauseTimeoutStreak) return { streak, paused: false };

  await redisConnection.set(
    pausedKey(deviceId),
    JSON.stringify({
      pausedAt: new Date().toISOString(),
      reason: 'snmp-timeout-streak',
      threshold: env.snmpAutoPauseTimeoutStreak,
      streak,
    }),
  );
  await redisConnection.del(key);
  return { streak, paused: true };
}

export async function clearSnmpTimeoutStreak(deviceId: string): Promise<void> {
  if (!env.snmpAutoPauseEnabled) return;
  await redisConnection.del(streakKey(deviceId));
}

export async function clearSnmpAutoPause(deviceId: string): Promise<void> {
  if (!env.snmpAutoPauseEnabled) return;
  await redisConnection.del(pausedKey(deviceId), streakKey(deviceId), pausedProbeLockKey(deviceId));
}

/**
 * Allows one SNMP resume probe per configured retry window for auto-paused devices.
 * Returns true only for the first poller that acquires the Redis NX lock.
 */
export async function shouldAttemptSnmpResumeProbe(deviceId: string): Promise<boolean> {
  if (!env.snmpAutoPauseEnabled) return false;
  const ttlSeconds = Math.max(60, env.snmpAutoPauseRetryMinutes * 60);
  const result = await redisConnection.set(pausedProbeLockKey(deviceId), '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}
