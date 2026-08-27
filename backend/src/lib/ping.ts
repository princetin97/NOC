import ping from 'ping';

export interface PingResult {
  alive: boolean;
  latencyMs: number | null;
  packetLoss: number;
}

export async function checkPing(ip: string): Promise<PingResult> {
  // -i 0.2 (200ms between echo requests, the fastest interval allowed without root)
  // keeps the same 3-packet sample for reliability but finishes in ~0.6s instead of
  // ~2s for a healthy host, which matters a lot when polling a large device fleet.
  const res = await ping.promise.probe(ip, { timeout: 3, extra: ['-c', '3', '-i', '0.2'] });
  const time = typeof res.time === 'number' ? res.time : null;
  const loss = Number.parseFloat(String(res.packetLoss ?? '100')) || 0;
  return { alive: res.alive, latencyMs: time, packetLoss: loss };
}
