import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../../lib/auth';
import { prisma } from '../../lib/db';

export interface AuthedRequest extends Request {
  user?: { sub: string; username: string; role: string; siteIds: string[]; isSystemAdmin: boolean };
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    const token = verifyToken(header.slice('Bearer '.length));
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      select: {
        id: true,
        username: true,
        role: true,
        siteMemberships: { select: { siteId: true } },
      },
    });
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    req.user = {
      sub: user.id,
      username: user.username,
      role: user.role,
      siteIds: user.siteMemberships.map((s) => s.siteId),
      isSystemAdmin: user.role === 'admin' && user.siteMemberships.length === 0,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(role: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (req.user?.role !== role) {
      res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này' });
      return;
    }
    next();
  };
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Chỉ tài khoản admin mới có quyền thực hiện thao tác này' });
    return;
  }
  next();
}

export function requireSystemAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isSystemAdmin) {
    res.status(403).json({ error: 'Chỉ admin hệ thống mới có quyền thực hiện thao tác này' });
    return;
  }
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Enforce read-only permissions for viewer accounts across protected APIs.
export function requireWriteAccess(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role === 'viewer' && !SAFE_METHODS.has(req.method.toUpperCase())) {
    res.status(403).json({ error: 'Tài khoản viewer chỉ có quyền xem dữ liệu' });
    return;
  }
  next();
}
