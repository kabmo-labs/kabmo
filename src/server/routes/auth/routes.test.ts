/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `/api/auth/*` request contract: login, password change, revoke, logout,
 * and state.
 *
 * These routes are the only door into the app, so each refusal branch is pinned
 * separately: a wrong password must not be distinguishable from a malformed
 * body (both are the same locked 401), a too-short new password must not be
 * accepted, and a revoked or password-changed token must stop verifying. The
 * state route is the client's only signal for "show login or show the app", so
 * its two booleans are pinned against a real minted cookie rather than a stub.
 *
 * Everything runs against a throwaway data dir: the module slot in
 * `lib/auth/guard` is process-wide, so `initAuth(null)` restores it for the
 * sibling suites that run in the same `bun test` process.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { action as login } from '@/server/routes/auth/login';
import { action as changePassword, MIN_PASSWORD_LENGTH } from '@/server/routes/auth/password';
import { action as logout } from '@/server/routes/auth/logout';
import { loader as authState } from '@/server/routes/auth/state';
import { initAuth, loadAuthConfig, revokeAllSessions } from '@/server/lib/auth/guard';
import { verifyPassword } from '@/server/lib/auth/config';
import { issueSessionToken, SESSION_TTL_MS, TRUSTED_DEVICE_TTL_MS } from '@/server/lib/auth/token';
import { resetLoginRateLimits } from '@/server/lib/auth/rate-limit';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-auth-routes-'));
const PASSWORD = 'correct-horse-battery';

beforeEach(async () => {
  // The login budget is keyed by the (unrecorded) client address, which is the
  // shared unknown-client key here, so every test would otherwise inherit the
  // previous test's failures.
  resetLoginRateLimits();
  Bun.env.KABMO_DATA_DIR = DATA_DIR;
  await initAuth(PASSWORD);
});

afterAll(async () => {
  await initAuth(null);
  delete Bun.env.KABMO_DATA_DIR;
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

function post(url: string, body: unknown, init: RequestInit = {}): Request {
  return new Request(url, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** The auth state a browser carrying `token` would be served. */
async function stateWith(token: string): Promise<Record<string, unknown>> {
  const req = new Request('http://localhost/api/auth/state', {
    headers: { cookie: `omp_session=${encodeURIComponent(token)}` },
  });
  return body((await authState({ request: req } as never)) as Response);
}

function tokenFrom(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  const match = /omp_session(?:_\d+)?=([^;]*)/.exec(header);
  return match ? decodeURIComponent(match[1]) : '';
}

describe('POST /api/auth/login', () => {
  test('refuses a wrong password with the locked 401 envelope', async () => {
    const res = (await login({
      request: post('http://localhost/api/auth/login', { password: 'nope' }),
    } as never)) as Response;
    expect(res.status).toBe(401);
    expect(await body(res)).toEqual({ error: 'Invalid password', locked: true });
    // One failure spent of the unknown-client budget of three.
    expect(res.headers.get('x-ratelimit-limit')).toBe('3');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('2');
  });

  test('a malformed JSON body is a wrong password, not a 400', async () => {
    const res = (await login({
      request: post('http://localhost/api/auth/login', 'not json'),
    } as never)) as Response;
    expect(res.status).toBe(401);
    expect((await body(res)).error).toBe('Invalid password');
  });

  test('a missing password field is a wrong password', async () => {
    const res = (await login({ request: post('http://localhost/api/auth/login', {}) } as never)) as Response;
    expect(res.status).toBe(401);
  });

  test('the correct password mints a session cookie', async () => {
    const res = (await login({
      request: post('http://localhost/api/auth/login', { password: PASSWORD }),
    } as never)) as Response;
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ authenticated: true, expiresInSec: SESSION_TTL_MS / 1000 });
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toContain('omp_session=');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
    expect(await stateWith(tokenFrom(res))).toEqual({ required: true, authenticated: true });
  });

  test('trustDevice extends the cookie to the trusted-device TTL', async () => {
    const res = (await login({
      request: post('http://localhost/api/auth/login', { password: PASSWORD, trustDevice: true }),
    } as never)) as Response;
    expect(await body(res)).toEqual({ authenticated: true, expiresInSec: TRUSTED_DEVICE_TTL_MS / 1000 });
    expect(res.headers.get('set-cookie')).toContain(`Max-Age=${TRUSTED_DEVICE_TTL_MS / 1000}`);
  });

  test('a lockout answers 429 and blocks even the correct password', async () => {
    const wrong = () =>
      login({ request: post('http://localhost/api/auth/login', { password: 'nope' }) } as never) as Promise<Response>;
    expect((await wrong()).status).toBe(401);
    expect((await wrong()).status).toBe(401);
    const third = await wrong();
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBe('900');
    expect((await body(third)).retryAfter).toBe(900);

    const correct = (await login({
      request: post('http://localhost/api/auth/login', { password: PASSWORD }),
    } as never)) as Response;
    expect(correct.status).toBe(429);
  });

  test('a wrong verb is a 405', async () => {
    const res = (await login({
      request: new Request('http://localhost/api/auth/login', { method: 'GET' }),
    } as never)) as Response;
    expect(res.status).toBe(405);
    expect((await body(res)).error).toBe('Method not allowed');
  });
});

describe('GET /api/auth/state', () => {
  test('reports required and unauthenticated without a cookie', async () => {
    const res = (await authState({ request: new Request('http://localhost/api/auth/state') } as never)) as Response;
    expect(await body(res)).toEqual({ required: true, authenticated: false });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('a token minted for the active password is authenticated', async () => {
    const config = loadAuthConfig()!;
    const token = issueSessionToken({ sessionSecret: config.sessionSecret, credentialKey: config.credentialKey });
    expect(await stateWith(token)).toEqual({ required: true, authenticated: true });
  });

  test('a token signed with the pre-revocation secret is not authenticated', async () => {
    const config = loadAuthConfig()!;
    const token = issueSessionToken({ sessionSecret: config.sessionSecret, credentialKey: config.credentialKey });
    await revokeAllSessions();
    expect(await stateWith(token)).toEqual({ required: true, authenticated: false });
  });
});

describe('POST /api/auth/password', () => {
  const url = 'http://localhost/api/auth/password';

  test('refuses a wrong current password', async () => {
    const res = (await changePassword({
      request: post(url, { currentPassword: 'wrong', newPassword: 'brand-new-pass' }),
    } as never)) as Response;
    expect(res.status).toBe(401);
    expect((await body(res)).error).toBe('Current password is incorrect');
  });

  test('rejects a new password below the minimum length', async () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const res = (await changePassword({
      request: post(url, { currentPassword: PASSWORD, newPassword: short }),
    } as never)) as Response;
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  });

  test('rejects a new password equal to the current one', async () => {
    const res = (await changePassword({
      request: post(url, { currentPassword: PASSWORD, newPassword: PASSWORD }),
    } as never)) as Response;
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe('New password must differ from the current one');
  });

  test('a malformed body is a 400 before any password check', async () => {
    const res = (await changePassword({ request: post(url, 'not json') } as never)) as Response;
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe('Invalid request body');
  });

  test('verifies the current password before the length rule', async () => {
    const res = (await changePassword({
      request: post(url, { currentPassword: 'wrong', newPassword: 'x' }),
    } as never)) as Response;
    expect(res.status).toBe(401);
  });

  test('changes the password and invalidates tokens minted for the old one', async () => {
    const before = loadAuthConfig()!;
    const oldToken = issueSessionToken({ sessionSecret: before.sessionSecret, credentialKey: before.credentialKey });

    const res = (await changePassword({
      request: post(url, { currentPassword: PASSWORD, newPassword: 'brand-new-pass' }),
    } as never)) as Response;
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ success: true, sessionsRevoked: true, persistsUntilRestart: true });

    const after = loadAuthConfig()!;
    expect(await verifyPassword('brand-new-pass', after.passwordHash)).toBe(true);
    expect(await verifyPassword(PASSWORD, after.passwordHash)).toBe(false);
    // The old cookie carries a fingerprint of the old credential key, so it
    // dies here.
    expect(await stateWith(oldToken)).toEqual({ required: true, authenticated: false });
    // This browser got a replacement cookie for the new key.
    expect(await stateWith(tokenFrom(res))).toEqual({ required: true, authenticated: true });
  });

  // Same regression as revoke, different cause: the new password derives a new
  // credential key, so the presented token stops verifying the moment it is
  // applied. The lifetime has to be read BEFORE that.
  test('the replacement cookie keeps the lifetime the session already had', async () => {
    const config = loadAuthConfig()!;
    const weekToken = issueSessionToken({
      sessionSecret: config.sessionSecret,
      credentialKey: config.credentialKey,
      ttlMs: TRUSTED_DEVICE_TTL_MS,
    });
    const res = (await changePassword({
      request: post(url, { currentPassword: PASSWORD, newPassword: 'brand-new-pass' }, {
        headers: { cookie: `omp_session=${encodeURIComponent(weekToken)}` },
      }),
    } as never)) as Response;
    const maxAge = Number(/Max-Age=(\d+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]);
    expect(maxAge).toBeGreaterThan(TRUSTED_DEVICE_TTL_MS / 1000 - 60);
    expect(maxAge).toBeLessThanOrEqual(TRUSTED_DEVICE_TTL_MS / 1000);
  });

  test('a wrong verb is a 405', async () => {
    const res = (await changePassword({
      request: new Request(url, { method: 'GET' }),
    } as never)) as Response;
    expect(res.status).toBe(405);
  });
});

describe('POST /api/auth/logout', () => {
  test('clears the cookie for the requesting host:port', async () => {
    const res = (await logout({
      request: new Request('http://localhost:5173/api/auth/logout', {
        method: 'POST',
        headers: { host: 'localhost:5173' },
      }),
    } as never)) as Response;
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ success: true });
    const header = res.headers.get('set-cookie') ?? '';
    // Port-scoped: signing out of one instance must not sign the user out of
    // another instance on a different port.
    expect(header).toContain('omp_session_5173=');
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });

  test('is public: it works with no auth configured at all', async () => {
    await initAuth(null);
    const res = (await logout({
      request: new Request('http://localhost/api/auth/logout', { method: 'POST' }),
    } as never)) as Response;
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ success: true });
  });

  test('a wrong verb is a 405', async () => {
    const res = (await logout({
      request: new Request('http://localhost/api/auth/logout', { method: 'GET' }),
    } as never)) as Response;
    expect(res.status).toBe(405);
  });
});

describe('auth routes when no password is configured', () => {
  beforeEach(async () => {
    await initAuth(null);
  });

  test('login refuses with 400 rather than pretending to check', async () => {
    const res = (await login({
      request: post('http://localhost/api/auth/login', { password: PASSWORD }),
    } as never)) as Response;
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe('UI authentication is not enabled');
  });

  test('password change refuses with 400', async () => {
    const res = (await changePassword({
      request: post('http://localhost/api/auth/password', { currentPassword: '', newPassword: 'whatever-1' }),
    } as never)) as Response;
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe('UI authentication is not enabled');
  });

  test('state reports not required and authenticated', async () => {
    const res = (await authState({ request: new Request('http://localhost/api/auth/state') } as never)) as Response;
    expect(await body(res)).toEqual({ required: false, authenticated: true });
  });
});
