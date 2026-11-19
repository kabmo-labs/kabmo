/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { action } from '@/server/routes/fs/git-message';
import { getDb } from '@/server/db.server';
import { writeSettingsJson } from '@/server/lib/db/settings-store';
import { SETTINGS_BLOB_KEY } from '@/shared/lib/settings/keys';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';

const FIXTURE_ROOT = path.join(process.cwd(), 'tmp-test-git-message');
const repos: string[] = [];

function makeRepo(): string {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'repo-'));
  repos.push(dir);
  const result = Bun.spawnSync({ cmd: ['git', 'init', '-q', '-b', 'main'], cwd: dir });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return dir;
}

async function post(body: unknown): Promise<{ status: number; body: { error?: string; code?: string } }> {
  const response = await action({
    request: new Request('http://localhost/api/fs/git-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never) as Response;
  return { status: response.status, body: (await response.json()) as { error?: string; code?: string } };
}

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

afterAll(() => {
  for (const dir of repos) removeDir(dir);
  removeDir(FIXTURE_ROOT);
});

describe('POST /api/fs/git-message', () => {
  test('GET is a 405, not a 404', async () => {
    const response = await action({
      request: new Request('http://localhost/api/fs/git-message'),
    } as never) as Response;
    expect(response.status).toBe(405);
  });

  test('an unreadable body is a 400', async () => {
    const response = await action({
      request: new Request('http://localhost/api/fs/git-message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
    } as never) as Response;
    expect(response.status).toBe(400);
  });

  test('a repo path outside the root is a 403', async () => {
    const dir = makeRepo();
    const result = await post({ root: dir, repo: '../escape' });
    expect(result.status).toBe(403);
  });

  test('an empty change set is a 409 before any model call', async () => {
    const dir = makeRepo();
    const db = await getDb();
    await writeSettingsJson(db, SETTINGS_BLOB_KEY, {
      commitMessageMode: 'omp',
      commitMessageModel: 'p/t',
    });

    const result = await post({ root: dir, repo: '.' });

    expect(result.status).toBe(409);
    expect(result.body.code).toBe('nothing_staged');
  });

  test('off is a 409 with the settings reason', async () => {
    const dir = makeRepo();
    const db = await getDb();
    await writeSettingsJson(db, SETTINGS_BLOB_KEY, { commitMessageMode: 'off' });

    const result = await post({ root: dir, repo: '.' });

    expect(result.status).toBe(409);
    expect(result.body.code).toBe('commit_message_off');
  });
});
