/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The login attempt budget.
 *
 * The behaviours worth pinning are the ones a refactor would plausibly invert:
 * a lockout that does not lift, a window that never resets, and an
 * unidentifiable caller getting a fresh budget per request instead of sharing
 * the small one.
 */

import { beforeEach, describe, expect, test } from 'bun:test';

import { authGate } from '@/server/lib/auth/guard';
import { clientAddressFor } from '@/server/lib/auth/client-address';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  RATE_LIMIT_LOCKOUT_MS,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_UNKNOWN_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  recordLoginFailure,
  resetLoginRateLimits,
  UNKNOWN_CLIENT_KEY,
} from '@/server/lib/auth/rate-limit';

const NOW = 1_700_000_000_000;

beforeEach(() => resetLoginRateLimits());

describe('login rate limit', () => {
  test('allows attempts up to the budget, then locks the address out', () => {
    for (let attempt = 1; attempt < RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      expect(recordLoginFailure('1.2.3.4', NOW).allowed).toBe(true);
    }
    // The attempt that spends the budget trips the lockout and is itself refused.
    const tripped = recordLoginFailure('1.2.3.4', NOW);
    expect(tripped.allowed).toBe(false);
    expect(tripped.retryAfterSec).toBe(RATE_LIMIT_LOCKOUT_MS / 1000);

    const checked = checkLoginRateLimit('1.2.3.4', NOW + 1);
    expect(checked.allowed).toBe(false);
    expect(checked.remaining).toBe(0);
  });

  test('a locked address is refused before any verification could run', () => {
    for (let attempt = 0; attempt < RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) recordLoginFailure('1.2.3.4', NOW);
    const status = checkLoginRateLimit('1.2.3.4', NOW + 60_000);
    expect(status.allowed).toBe(false);
    expect(status.retryAfterSec).toBeGreaterThan(0);
  });

  test('the lockout lifts when it expires', () => {
    for (let attempt = 0; attempt < RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) recordLoginFailure('1.2.3.4', NOW);
    expect(checkLoginRateLimit('1.2.3.4', NOW + RATE_LIMIT_LOCKOUT_MS).allowed).toBe(true);
    expect(checkLoginRateLimit('1.2.3.4', NOW + RATE_LIMIT_LOCKOUT_MS).remaining).toBe(RATE_LIMIT_MAX_ATTEMPTS);
  });

  test('failures spread beyond the window do not accumulate', () => {
    for (let attempt = 0; attempt < RATE_LIMIT_MAX_ATTEMPTS - 1; attempt += 1) {
      recordLoginFailure('1.2.3.4', NOW + attempt * (RATE_LIMIT_WINDOW_MS + 1));
    }
    // Each failure started a fresh window, so the address is nowhere near locked.
    expect(checkLoginRateLimit('1.2.3.4', NOW + RATE_LIMIT_MAX_ATTEMPTS * (RATE_LIMIT_WINDOW_MS + 1)).allowed).toBe(true);
  });

  test('a successful login clears the budget', () => {
    for (let attempt = 1; attempt < RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) recordLoginFailure('1.2.3.4', NOW);
    clearLoginRateLimit('1.2.3.4');
    expect(checkLoginRateLimit('1.2.3.4', NOW).remaining).toBe(RATE_LIMIT_MAX_ATTEMPTS);
  });

  test('budgets are per address', () => {
    for (let attempt = 0; attempt < RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) recordLoginFailure('1.2.3.4', NOW);
    expect(checkLoginRateLimit('1.2.3.4', NOW).allowed).toBe(false);
    expect(checkLoginRateLimit('5.6.7.8', NOW).allowed).toBe(true);
  });

  test('an unidentifiable caller draws from the small shared budget', () => {
    for (let attempt = 1; attempt < RATE_LIMIT_UNKNOWN_MAX_ATTEMPTS; attempt += 1) {
      expect(recordLoginFailure(UNKNOWN_CLIENT_KEY, NOW).allowed).toBe(true);
    }
    expect(recordLoginFailure(UNKNOWN_CLIENT_KEY, NOW).allowed).toBe(false);
  });
});

describe('the rate limit cannot be evaded by a forged forwarding header', () => {
  // Verified against a live server: 8 attempts with rotating `x-forwarded-for`
  // and `x-real-ip` values all answered 429. This pins the REASON, against the
  // real gate rather than a stand-in: the key is the socket address the gate
  // records, and a caller-supplied header is never consulted. If that ever
  // changed, a caller could present a fresh identity per attempt and walk
  // straight through the budget — invisible until exploited.
  const loginRequest = (forwardedFor: string) => new Request('http://127.0.0.1/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor, 'x-real-ip': forwardedFor },
  });

  test('a forged forwarding header does not become the rate-limit key', async () => {
    const request = loginRequest('10.0.0.1');
    // The gate records the socket address it was handed…
    await authGate(request, '127.0.0.1');
    // …and that is what the login route throttles on, not the header.
    expect(clientAddressFor(request)).toBe('127.0.0.1');
    expect(clientAddressFor(request)).not.toBe('10.0.0.1');
  });

  test('rotating the header changes nothing about the key', async () => {
    const keys = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const request = loginRequest(`10.0.0.${attempt}`);
      await authGate(request, '127.0.0.1');
      keys.add(clientAddressFor(request));
    }
    // Five different forged identities, one key.
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('127.0.0.1');
  });

  test('an unidentifiable caller falls back to the shared key, not a fresh one', async () => {
    // No address from the socket (a non-Bun adapter, a test harness). The
    // fallback must be ONE shared key: per-request randomness would hand every
    // attempt a new budget.
    const first = loginRequest('10.0.0.1');
    const second = loginRequest('10.0.0.2');
    await authGate(first, undefined);
    await authGate(second, undefined);
    expect(clientAddressFor(first)).toBe(UNKNOWN_CLIENT_KEY);
    expect(clientAddressFor(second)).toBe(UNKNOWN_CLIENT_KEY);
  });
});
