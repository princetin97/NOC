import { apiClient, setToken, clearToken, getToken } from './apiClient';

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  siteIds?: string[];
  isSystemAdmin?: boolean;
}

const USER_KEY = 'auth_user';

interface LoginResponse {
  token: string;
  user: AuthUser;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await apiClient.post<LoginResponse>('/auth/login', { username, password });
  setToken(res.token);
  localStorage.setItem(USER_KEY, JSON.stringify(res.user));
  return res.user;
}

// Exchanges the current (still-valid) token for a fresh one to keep active
// sessions alive. Returns the refreshed user, or null if refresh failed.
export async function refreshSession(): Promise<AuthUser | null> {
  if (!getToken()) return null;
  try {
    const res = await apiClient.post<LoginResponse>('/auth/refresh');
    setToken(res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    return res.user;
  } catch {
    return null;
  }
}

export function logout(): void {
  clearToken();
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return Boolean(getToken());
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}
