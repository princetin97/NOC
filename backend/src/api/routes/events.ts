import { Router } from 'express';
import { prisma } from '../../lib/db';
import type { AuthedRequest } from '../middleware/auth';
import { canAccessSite, eventScopeWhere } from '../middleware/site-scope';

export const eventsRouter = Router();

const EVENT_LIST_CACHE_TTL_MS = 3000;
const eventListCache = new Map<string, { expiresAt: number; payload: unknown }>();

function eventScopeCacheKey(req: AuthedRequest): string {
  const isSystemAdmin = req.user?.isSystemAdmin === true;
  if (isSystemAdmin) return 'global';
  const siteIds = (req.user?.siteIds ?? []).slice().sort().join(',');
  return `sites:${siteIds}`;
}

eventsRouter.get('/', async (req: AuthedRequest, res) => {
  const deviceId = req.query.deviceId as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  const requestedSiteIdRaw = req.query.siteId;
  const requestedSiteId = typeof requestedSiteIdRaw === 'string' && requestedSiteIdRaw.length > 0 ? requestedSiteIdRaw : undefined;
  if (requestedSiteId && !canAccessSite(req, requestedSiteId)) {
    res.status(403).json({ error: 'Bạn không có quyền truy cập trụ sở này' });
    return;
  }

  const cacheKey = `${eventScopeCacheKey(req)}|device:${deviceId ?? 'all'}|site:${requestedSiteId ?? 'all'}|limit:${limit}`;
  const now = Date.now();
  const cached = eventListCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    res.json(cached.payload);
    return;
  }

  const scoped = eventScopeWhere(req);
  const events = await prisma.eventLog.findMany({
    where: {
      ...(deviceId ? { deviceId } : {}),
      ...(scoped ?? {}),
      ...(requestedSiteId ? { device: { siteId: requestedSiteId } } : {}),
    },
    orderBy: { timestamp: 'desc' },
    include: { device: { select: { name: true } } },
    take: limit,
  });
  eventListCache.set(cacheKey, { expiresAt: now + EVENT_LIST_CACHE_TTL_MS, payload: events });
  res.json(events);
});
