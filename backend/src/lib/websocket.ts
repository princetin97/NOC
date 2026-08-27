import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from './env';

let io: SocketIOServer | null = null;

export function initWebsocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: env.corsOrigin },
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
