/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Login throttling: a per-IP attempt budget in front of the password check.
 *
 * argon2id already makes one guess cost ~70 ms, but that only bounds the RATE of
 * guesses — it does not stop a script from running them for a week. This bounds
 * the NUMBER of failures instead: past the budget the address is locked out
 * outright, and no verification runs at all.
 *
 * State is in-memory and therefore resets when the process restarts. That is the
 * right trade for a single-user console: a persisted lockout would have to be
 * cleared by hand after a restart, and the process is only reachable at all
 * because someone chose to expose it.
 *
 * The key is the SOCKET address (`requestIP`), never `x-forwarded-for`: that
 * header is caller-supplied, so trusting it would let one client present a fresh
 * identity per attempt and walk straight through the budget. Behind a reverse
 * proxy every client shares the proxy's socket address, which throttles them
 * together — the conservative direction for a limit whose job is to fail closed.
 */

/** Sliding window an attempt count is measured over. */
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

/** Failures allowed within the window before the lockout. */
export const RATE_LIMIT_MAX_ATTEMPTS = 10;

/** How long a tripped lockout lasts. */
export const RATE_LIMIT_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Budget for a request whose address could not be determined. Lower than the
 * per-IP budget on purpose: an unidentifiable caller cannot be distinguished
 * from any other, so the budget they share must be small.
 */
export const RATE_LIMIT_UNKNOWN_MAX_ATTEMPTS = 3;

/** Key used when the socket address is unavailable. */
export const UNKNOWN_CLIENT_KEY = 'unknown-client';

interface AttemptRecord {
  count: number;
  lastAttempt: number;
  lockedUntil: number;
}

const attempts = new Map<string, AttemptRecord>();

/** Entries older than this are dropped opportunistically; see `prune`. */
const STALE_AFTER_MS = 60 * 60 * 1000;

const MAX_TRACKED_CLIENTS = 4096;

function maxAttemptsFor(key: string): number {
  return key === UNKNOWN_CLIENT_KEY ? RATE_LIMIT_UNKNOWN_MAX_ATTEMPTS : RATE_LIMIT_MAX_ATTEMPTS;
}

/**
 * Drop records that are neither locked nor recently touched.
 *
 * Runs on write rather than on a timer: a module-level interval would have to be
 * unref'd and torn down, and this map is written exactly when a login fails —
 * which is also the only moment it can grow.
 */
function prune(now: number): void {
  if (attempts.size < MAX_TRACKED_CLIENTS) return;
  for (const [key, record] of attempts) {
    const locked = record.lockedUntil > now;
    if (!locked && now - record.lastAttempt > STALE_AFTER_MS) attempts.delete(key);
  }
}

export interface RateLimitStatus {
  allowed: boolean;
  /** Seconds until the lockout lifts; only present when `allowed` is false. */
  retryAfterSec?: number;
  limit: number;
  remaining: number;
}

/** Whether this key may attempt a login right now. Does not consume the budget. */
export function checkLoginRateLimit(key: string, now = Date.now()): RateLimitStatus {
  const limit = maxAttemptsFor(key);
  const record = attempts.get(key);

  if (!record) return { allowed: true, limit, remaining: limit };

  if (record.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((record.lockedUntil - now) / 1000),
      limit,
      remaining: 0,
    };
  }

  // A lockout that has run out, or a window that has gone quiet, both start over.
  if (record.lockedUntil > 0 || now - record.lastAttempt > RATE_LIMIT_WINDOW_MS) {
    attempts.delete(key);
    return { allowed: true, limit, remaining: limit };
  }

  return { allowed: true, limit, remaining: Math.max(0, limit - record.count) };
}

/**
 * Record a failed attempt, tripping the lockout once the budget is spent.
 * Returns the status AFTER the failure, so the caller can answer 429 immediately.
 */
export function recordLoginFailure(key: string, now = Date.now()): RateLimitStatus {
  const limit = maxAttemptsFor(key);
  const record = attempts.get(key);

  if (!record || now - record.lastAttempt > RATE_LIMIT_WINDOW_MS) {
    attempts.set(key, { count: 1, lastAttempt: now, lockedUntil: 0 });
    prune(now);
    return { allowed: true, limit, remaining: limit - 1 };
  }

  const count = record.count + 1;
  const lockedUntil = count >= limit ? now + RATE_LIMIT_LOCKOUT_MS : 0;
  attempts.set(key, { count, lastAttempt: now, lockedUntil });
  prune(now);

  if (lockedUntil > 0) {
    return { allowed: false, retryAfterSec: Math.ceil(RATE_LIMIT_LOCKOUT_MS / 1000), limit, remaining: 0 };
  }
  return { allowed: true, limit, remaining: Math.max(0, limit - count) };
}

/** Forget a key's failures — called after a successful login. */
export function clearLoginRateLimit(key: string): void {
  attempts.delete(key);
}

/** Drop every record. Test seam; the process otherwise keeps them for its life. */
export function resetLoginRateLimits(): void {
  attempts.clear();
}
