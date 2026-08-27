import type { Prisma } from '@prisma/client';
import type { AuthedRequest } from './auth';

export function isGlobalAdmin(req: AuthedRequest): boolean {
  return req.user?.isSystemAdmin === true;
}

export function getScopedSiteIds(req: AuthedRequest): string[] {
  return req.user?.siteIds ?? [];
}

export function canAccessSite(req: AuthedRequest, siteId: string | null | undefined): boolean {
  if (isGlobalAdmin(req)) return true;
  if (!siteId) return false;
  return getScopedSiteIds(req).includes(siteId);
}

export function deviceSiteWhere(req: AuthedRequest): Prisma.DeviceWhereInput | undefined {
  if (isGlobalAdmin(req)) return undefined;
  return { siteId: { in: getScopedSiteIds(req) } };
}

export function serviceSiteWhere(req: AuthedRequest): Prisma.ServiceCheckWhereInput | undefined {
  if (isGlobalAdmin(req)) return undefined;
  return { siteId: { in: getScopedSiteIds(req) } };
}

export function alertScopeWhere(req: AuthedRequest): Prisma.AlertWhereInput | undefined {
  if (isGlobalAdmin(req)) return undefined;
  const siteIds = getScopedSiteIds(req);
  return {
    OR: [{ device: { siteId: { in: siteIds } } }, { service: { siteId: { in: siteIds } } }],
  };
}

export function eventScopeWhere(req: AuthedRequest): Prisma.EventLogWhereInput | undefined {
  if (isGlobalAdmin(req)) return undefined;
  return { device: { siteId: { in: getScopedSiteIds(req) } } };
}

export function notificationSiteWhere(req: AuthedRequest): Prisma.NotificationChannelWhereInput | undefined {
  if (isGlobalAdmin(req)) return undefined;
  return { siteId: { in: getScopedSiteIds(req) } };
}

export function dashboardSiteWhere(req: AuthedRequest): Prisma.DashboardWhereInput | undefined {
  if (isGlobalAdmin(req)) return undefined;
  return { siteId: { in: getScopedSiteIds(req) } };
}

export function alertRuleScopeWhere(req: AuthedRequest): Prisma.AlertRuleWhereInput | undefined {
  if (isGlobalAdmin(req)) return undefined;
  const siteIds = getScopedSiteIds(req);
  return {
    OR: [
      { siteId: { in: siteIds } },
      { device: { siteId: { in: siteIds } } },
      { service: { siteId: { in: siteIds } } },
    ],
  };
}

export function mapNodeSiteWhere(req: AuthedRequest): Prisma.MapNodeWhereInput | undefined {
  if (isGlobalAdmin(req)) return undefined;
  const siteIds = getScopedSiteIds(req);
  return {
    OR: [{ siteId: { in: siteIds } }, { device: { siteId: { in: siteIds } } }],
  };
}

export function virtualizationManagerSiteWhere(req: AuthedRequest): Prisma.VirtualizationManagerWhereInput | undefined {
  if (isGlobalAdmin(req)) return undefined;
  return { siteId: { in: getScopedSiteIds(req) } };
}
