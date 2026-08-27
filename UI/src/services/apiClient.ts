/**
 * Thin fetch wrapper around the backend REST API (proxied same-origin under /api
 * by server.ts). Attaches the JWT bearer token and normalizes error handling.
 */

const TOKEN_KEY = 'auth_token';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...options, headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, `Hết thời gian chờ phản hồi từ máy chủ (${Math.round(timeoutMs / 1000)}s). Vui lòng kiểm tra kết nối/backend.`);
    }
    throw new ApiError(0, 'Không thể kết nối tới máy chủ.');
  } finally {
    clearTimeout(timeoutId);
  }

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new ApiError(401, 'Unauthorized');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') || '';
  let data: unknown;
  let rawText = '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = undefined;
    }
  } else {
    try {
      rawText = (await res.text()).trim();
    } catch {
      rawText = '';
    }
  }

  if (!res.ok) {
    const payload = data as { error?: unknown } | undefined;
    const structuredError = payload?.error;
    const structuredMessage =
      typeof structuredError === 'string'
        ? structuredError
        : structuredError && typeof structuredError === 'object' && 'message' in structuredError
          ? String((structuredError as { message?: unknown }).message ?? '')
          : '';
    const looksLikeHtml = /<html|<!doctype html|<body|<title/i.test(rawText);
    const textMessage = looksLikeHtml ? '' : rawText;
    const proxyHint = looksLikeHtml && (res.status === 502 || res.status === 504)
      ? 'Gateway timeout từ reverse proxy. Yêu cầu backend mất quá lâu hoặc không phản hồi ổn định.'
      : '';
    const message =
      structuredMessage ||
      textMessage ||
      proxyHint ||
      res.statusText ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, typeof message === 'string' ? message : JSON.stringify(message));
  }

  return data as T;
}

export const apiClient = {
  get: <T>(path: string, timeoutMs?: number) => request<T>(path, { method: 'GET' }, timeoutMs),
  post: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }, timeoutMs),
  put: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }, timeoutMs),
  patch: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }, timeoutMs),
  delete: <T>(path: string, timeoutMs?: number) => request<T>(path, { method: 'DELETE' }, timeoutMs),
};
