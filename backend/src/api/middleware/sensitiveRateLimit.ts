import type { Request, Response, NextFunction } from 'express';
import { SlidingWindowRateLimiter, normalizeIp } from '../../lib/security';
import { logger } from '../../lib/logger';

export function createSensitiveRateLimit(options: { windowMs: number; maxAttempts: number; scope: string }) {
  const limiter = new SlidingWindowRateLimiter({ windowMs: options.windowMs, maxAttempts: options.maxAttempts });

  return (req: Request, res: Response, next: NextFunction): void => {
    const safeMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (safeMethod) {
      next();
      return;
    }

    const key = `${normalizeIp(req.ip)}:${options.scope}`;
    if (limiter.isBlocked(key)) {
      logger.warn({ ip: normalizeIp(req.ip), scope: options.scope, path: req.path, status: 429 }, 'Sensitive API rejected by rate limiter');
      res.status(429).json({ error: 'Too many write requests. Please retry later.' });
      return;
    }

    limiter.registerFailure(key);
    next();
  };
}
