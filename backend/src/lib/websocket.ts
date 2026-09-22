import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './env';
import { verifyToken } from './auth';
import { prisma } from './db';
import { logger } from './logger';
import { normalizeIp } from './security';

export function extractSocketToken(authToken: unknown, authorizationHeader: unknown): string {
  const fromAuth = typeof authToken === 'string' ? authToken.trim() : '';
  if (fromAuth) return fromAuth;

  const header = typeof authorizationHeader === 'string' ? authorizationHeader : '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return '';
}

export async function authenticateSocketToken(tokenValue: string): Promise<boolean> {
  if (!tokenValue) return false;
  const token = verifyToken(tokenValue);
  const user = await prisma.user.findUnique({ where: { id: token.sub }, select: { id: true } });
  return !!user;
}

let io: SocketIOServer | null = null;

export function initWebsocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: env.corsOrigin },
  });

  io.use(async (socket, next) => {
    try {
      const tokenValue = extractSocketToken(socket.handshake.auth?.token, socket.handshake.headers.authorization);
      if (!tokenValue) {
        logger.warn({ ip: normalizeIp(socket.handshake.address), reason: 'missing-token' }, 'Websocket auth rejected');
        return next(new Error('Missing auth token'));
      }

      if (!(await authenticateSocketToken(tokenValue))) {
        logger.warn({ ip: normalizeIp(socket.handshake.address), reason: 'user-not-found' }, 'Websocket auth rejected');
        return next(new Error('User not found'));
      }

      return next();
    } catch {
      logger.warn({ ip: normalizeIp(socket.handshake.address), reason: 'invalid-token' }, 'Websocket auth rejected');
      return next(new Error('Invalid or expired token'));
    }
  });

  return io;
}

/** Broadcast an event to all connected dashboard clients (used by the poller/collectors). */
export function broadcast(event: string, payload: unknown): void {
  io?.emit(event, payload);
}

export function getIO(): SocketIOServer | null {
  return io;
}
