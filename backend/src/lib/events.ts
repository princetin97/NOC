import IORedis from 'ioredis';
import { env } from './env';

// Cross-process realtime event bus: the poller/collectors run in separate
// containers from the API, so we use Redis pub/sub to fan events out to the
// API process, which then re-broadcasts them to connected UI clients over WebSocket.
const CHANNEL = 'monitor:events';

const publisher = new IORedis(env.redisUrl);

export function publishEvent(event: string, payload: unknown): Promise<number> {
  return publisher.publish(CHANNEL, JSON.stringify({ event, payload }));
}

export function subscribeEvents(handler: (event: string, payload: unknown) => void): void {
  const subscriber = new IORedis(env.redisUrl);
  subscriber.subscribe(CHANNEL).catch(() => undefined);
  subscriber.on('message', (_channel, message) => {
    try {
      const parsed = JSON.parse(message) as { event: string; payload: unknown };
      handler(parsed.event, parsed.payload);
    } catch {
      // ignore malformed message
    }
  });
}
