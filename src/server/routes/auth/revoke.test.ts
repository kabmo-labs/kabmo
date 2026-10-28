/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Session revocation, and the lifetime it must preserve.
 *
 * Split from `routes.test.ts` when that file reached the size ceiling. The
 * behaviour worth its own file is the reissue: revoking rotates the signing
 * secret, so the presented token stops verifying the moment it happens — which
 * means the lifetime has to be read BEFORE the rotation, or the replacement
 * silently falls back to the 12-hour default.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { action as revoke } from '@/server/routes/auth/revoke';
import { loader as authState } from '@/server/routes/auth/state';
import { initAuth, loadAuthConfig } from '@/server/lib/auth/guard';
import { issueSessionToken, TRUSTED_DEVICE_TTL_MS } from '@/server/lib/auth/token';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omc-auth-revoke-'));
const PASSWORD = 'correct-horse-battery';

beforeEach(async () => {
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

async function stateWith(token: string): Promise<Record<string, unknown>> {
  const req = new Request('http://localhost/api/auth/state', {
    headers: { cookie: `omp_session=${encodeURIComponent(token)}` },
  });
  return body((await authState({ request: req } as never)) as Response);
}

function tokenFrom(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  const match = /omp_session(?:\d+)?=([^;]*)/.exec(header.replace('omp_session_', 'omp_session'));
  return match ? decodeURIComponent(match[1]) : '';
}

describe('POST /api/auth/revoke', () => {
  const url = 'http://localhost/api/auth/revoke';

  test('rotates the secret, killing old tokens and re-issuing this browser', async () => {
    const before = loadAuthConfig()!;
    const oldToken = issueSessionToken({ sessionSecret: before.sessionSecret, credentialKey: before.credentialKey });

    const res = (await revoke({ request: post(url, {}) } as never)) as Response;
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ success: true, sessionsRevoked: true, persisted: true });
    expect(await stateWith(oldToken)).toEqual({ required: true, authenticated: false });
    expect(await stateWith(tokenFrom(res))).toEqual({ required: true, authenticated: true });
  });

  // The regression: revocation rotates the secret, so the presented token stops
  // verifying the moment it happens. Reading the TTL afterwards always answered
  // "unusable" and fell back to the 12-hour default — measured, a 7-day session
  // came back as `Max-Age=43200`.
  test('re-issues THIS browser with the lifetime it already had', async () => {
    const config = loadAuthConfig()!;
    const weekToken = issueSessionToken({
      sessionSecret: config.sessionSecret,
      credentialKey: config.credentialKey,
      ttlMs: TRUSTED_DEVICE_TTL_MS,
    });
    const res = (await revoke({
      request: post(url, {}, { headers: { cookie: `omp_session=${encodeURIComponent(weekToken)}` } }),
    } as never)) as Response;
    const maxAge = Number(/Max-Age=(\d+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]);
    // A week minus the moment it took to run this, never the 12-hour default.
    expect(maxAge).toBeGreaterThan(TRUSTED_DEVICE_TTL_MS / 1000 - 60);
    expect(maxAge).toBeLessThanOrEqual(TRUSTED_DEVICE_TTL_MS / 1000);
  });

  test('a wrong verb is a 405', async () => {
    const res = (await revoke({ request: new Request(url, { method: 'GET' }) } as never)) as Response;
    expect(res.status).toBe(405);
  });
});


describe('POST /api/auth/revoke with authentication off', () => {
  test('refuses with 400 rather than revoking nothing', async () => {
    await initAuth(null);
    const res = (await revoke({
      request: post('http://localhost/api/auth/revoke', {}),
    } as never)) as Response;
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe('UI authentication is not enabled');
  });
});
