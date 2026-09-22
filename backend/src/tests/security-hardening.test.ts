import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBootstrapRequest, SlidingWindowRateLimiter } from '../lib/security';
import { extractSocketToken } from '../lib/websocket';

test('bootstrap rejects when AUTH_BOOTSTRAP_TOKEN is missing', () => {
  const result = checkBootstrapRequest({ configuredToken: '', providedToken: 'abc', userCount: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('bootstrap accepts valid token when no users exist', () => {
  const result = checkBootstrapRequest({ configuredToken: 'token-1', providedToken: 'token-1', userCount: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
});

test('login-style limiter blocks after max attempts in window', () => {
  let now = 1_000;
  const limiter = new SlidingWindowRateLimiter({ windowMs: 60_000, maxAttempts: 3, now: () => now });
  const key = '127.0.0.1:user';

  limiter.registerFailure(key);
  limiter.registerFailure(key);
  assert.equal(limiter.isBlocked(key), false);

  limiter.registerFailure(key);
  assert.equal(limiter.isBlocked(key), true);

  now += 61_000;
  assert.equal(limiter.isBlocked(key), false);
});

test('socket auth token extraction prefers handshake auth token', () => {
  const token = extractSocketToken('direct-token', 'Bearer header-token');
  assert.equal(token, 'direct-token');
});

test('socket auth token extraction falls back to Authorization bearer header', () => {
  const token = extractSocketToken(undefined, 'Bearer header-token');
  assert.equal(token, 'header-token');
});
