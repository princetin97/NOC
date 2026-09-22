import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './env';
import { verifyToken } from './auth';
import { prisma } from './db';

let io: SocketIOServer | null = null;

export function initWebsocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: env.corsOrigin },
  });

  io.use(async (socket, next) => {
    try {
      const fromAuth = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
      const authHeader = typeof socket.handshake.headers.authorization === 'string' ? socket.handshake.headers.authorization : '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
      const tokenValue = fromAuth || bearer;
      if (!tokenValue) {
        return next(new Error('Missing auth token'));
      }

      const token = verifyToken(tokenValue);
      const user = await prisma.user.findUnique({ where: { id: token.sub }, select: { id: true } });
      if (!user) {
        return next(new Error('User not found'));
      }

      return next();
    } catch {
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
