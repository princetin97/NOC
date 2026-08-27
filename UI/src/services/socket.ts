import { io, Socket } from 'socket.io-client';
import { getToken } from './apiClient';

let socket: Socket | null = null;

/**
 * Returns a singleton Socket.IO client connected same-origin (proxied to the
 * backend by server.ts), so no hardcoded backend hostname is needed.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      auth: { token: getToken() },
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
