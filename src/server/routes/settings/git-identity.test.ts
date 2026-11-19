/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The global identity route's request shape.
 *
 * The apply/restore logic is tested against a temp config file in
 * `git-identity.server.test.ts`; this file never writes the developer's real
 * global config. It covers the read, the body guard, and the unknown-id refusal.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { action, loader } from '@/server/routes/settings/git-identity';
import { getDb } from '@/server/db.server';
import { writeSettingsJson } from '@/server/lib/db/settings-store';
import { SETTINGS_BLOB_KEY } from '@/shared/lib/settings/keys';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

const API = 'http://localhost/api/settings/git-identity';

async function post(body: unknown): Promise<{ status: number; body: { error?: string; global?: unknown; appliedId?: string | null } }> {
  const response = await action({
    request: new Request(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never) as Response;
  return { status: response.status, body: (await response.json()) as { error?: string; global?: unknown; appliedId?: string | null } };
}

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('GET /api/settings/git-identity', () => {
  test('answers the global identity shape', async () => {
    const response = await loader({ request: new Request(API) } as never) as Response;
    const body = await response.json() as { success?: boolean; global?: unknown; appliedId?: string | null };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect('global' in body).toBe(true);
    expect('appliedId' in body).toBe(true);
  });
});

describe('POST /api/settings/git-identity', () => {
  test('an unreadable body is a 400', async () => {
    const response = await action({
      request: new Request(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
    } as never) as Response;
    expect(response.status).toBe(400);
  });

  test('an unknown identity is refused before touching git', async () => {
    const db = await getDb();
    await writeSettingsJson(db, SETTINGS_BLOB_KEY, {
      gitIdentities: [{ id: 'work', name: 'Work User', email: 'work@example.invalid' }],
    });

    const result = await post({ identityId: 'missing' });

    expect(result.status).toBe(400);
    expect(result.body.error).toContain('no longer exists');
  });
});
