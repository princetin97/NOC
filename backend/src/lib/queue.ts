import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from './env';

export const redisConnection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

export const pollQueue = new Queue('device-poll', { connection: redisConnection });
export const discoveryQueue = new Queue('device-discovery', { connection: redisConnection });
export const serviceCheckQueue = new Queue('service-check', { connection: redisConnection });
