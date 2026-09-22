export interface BootstrapCheckInput {
  configuredToken: string;
  providedToken: string;
  userCount: number;
}

export interface BootstrapCheckResult {
  ok: boolean;
  status: number;
  error?: string;
}

export function checkBootstrapRequest(input: BootstrapCheckInput): BootstrapCheckResult {
  if (!input.configuredToken) {
    return { ok: false, status: 503, error: 'AUTH_BOOTSTRAP_TOKEN is not configured on the server' };
  }
  if (input.providedToken !== input.configuredToken) {
    return { ok: false, status: 401, error: 'Invalid bootstrap token' };
  }
  if (input.userCount > 0) {
    return { ok: false, status: 409, error: 'Bootstrap is disabled because users already exist' };
  }
  return { ok: true, status: 200 };
}

export interface SlidingWindowRateLimiterOptions {
  windowMs: number;
  maxAttempts: number;
  now?: () => number;
}

interface AttemptState {
  count: number;
  resetAt: number;
}

export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;
  private readonly attempts = new Map<string, AttemptState>();

  constructor(options: SlidingWindowRateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxAttempts = options.maxAttempts;
    this.now = options.now ?? (() => Date.now());
  }

  isBlocked(key: string): boolean {
    const timestamp = this.now();
    const state = this.attempts.get(key);
    if (!state) return false;
    if (state.resetAt <= timestamp) {
      this.attempts.delete(key);
      return false;
    }
    return state.count >= this.maxAttempts;
  }

  registerFailure(key: string): void {
    const timestamp = this.now();
    const state = this.attempts.get(key);
    if (!state || state.resetAt <= timestamp) {
      this.attempts.set(key, { count: 1, resetAt: timestamp + this.windowMs });
      return;
    }
    state.count += 1;
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}

export function normalizeIp(value: string | undefined): string {
  return (value ?? 'unknown').trim().toLowerCase();
}
