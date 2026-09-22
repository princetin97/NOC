import { env } from '../lib/env';

interface CooldownState {
  streak: number;
  nextEligibleAt: number;
}

const cooldownByDevice = new Map<string, CooldownState>();

function computeBackoffSeconds(streak: number): number {
  const exp = Math.max(0, streak - 1);
  const delay = env.pollFailureBackoffBaseSeconds * 2 ** exp;
  return Math.min(env.pollFailureBackoffMaxSeconds, delay);
}

export function markPollFailure(deviceId: string): { streak: number; delaySeconds: number } {
  const now = Date.now();
  const prev = cooldownByDevice.get(deviceId);
  const streak = (prev?.streak ?? 0) + 1;
  const delaySeconds = computeBackoffSeconds(streak);
  cooldownByDevice.set(deviceId, {
    streak,
    nextEligibleAt: now + delaySeconds * 1000,
  });
  return { streak, delaySeconds };
}

export function markPollSuccess(deviceId: string): void {
  cooldownByDevice.delete(deviceId);
}

export function getPollCooldownRemainingMs(deviceId: string): number {
  const state = cooldownByDevice.get(deviceId);
  if (!state) return 0;
  return Math.max(0, state.nextEligibleAt - Date.now());
}

export function shouldPollDeviceNow(deviceId: string): boolean {
  return getPollCooldownRemainingMs(deviceId) === 0;
}
