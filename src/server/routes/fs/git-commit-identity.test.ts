/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commit identity, driven through the real commit action.
 *
 * The setting is a per-command override (`-c user.name=… -c user.email=…`), so
 * the assertions are git's own `%an`/`%ae` and `%cn`/`%ce` — not the settings
 * blob. A test that only read the blob would pass while the commit still
 * carried the repository's identity.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { action } from '@/server/routes/fs/git';
import { getDb } from '@/server/db.server';
import { writeSettingsJson } from '@/server/lib/db/settings-store';
import { SETTINGS_BLOB_KEY } from '@/shared/lib/settings/keys';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';

const FIXTURE_ROOT = path.join(process.cwd(), 'tmp-test-git-identity');
const repos: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function makeRepo(): string {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'repo-'));
  repos.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

async function post(fields: Record<string, string>): Promise<{ status: number; body: { success?: boolean; error?: string } }> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await action({
    request: new Request('http://localhost/api/fs/git', { method: 'POST', body: form }),
  } as never) as Response;
  return { status: response.status, body: (await response.json()) as { success?: boolean; error?: string } };
}

async function selectIdentity(identity: { id: string; name: string; email: string } | null): Promise<void> {
  const db = await getDb();
  await writeSettingsJson(db, SETTINGS_BLOB_KEY, {
    gitIdentities: identity ? [identity] : [],
    gitCommitIdentity: identity?.id ?? '',
  });
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

describe('commit identity', () => {
  test('no selection uses the repository config', async () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git(dir, 'add', 'a.txt');

    const result = await post({ root: dir, repo: '.', actionType: 'commit', message: 'feat: a' });

    expect(result.status).toBe(200);
    expect(git(dir, 'log', '-1', '--format=%an <%ae>|%cn <%ce>'))
      .toBe('Test <test@example.invalid>|Test <test@example.invalid>');
  });

  test('a selected identity is the author and the committer', async () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git(dir, 'add', 'a.txt');
    await selectIdentity({ id: 'work', name: 'Work User', email: 'work@example.invalid' });

    const result = await post({ root: dir, repo: '.', actionType: 'commit', message: 'feat: a' });

    expect(result.status).toBe(200);
    expect(git(dir, 'log', '-1', '--format=%an <%ae>|%cn <%ce>'))
      .toBe('Work User <work@example.invalid>|Work User <work@example.invalid>');
  });

  test('an amend with a selected identity rewrites the author', async () => {
    const dir = makeRepo();
    await selectIdentity({ id: 'work', name: 'Work User', email: 'work@example.invalid' });

    const result = await post({
      root: dir,
      repo: '.',
      actionType: 'commit',
      message: 'base amended',
      amend: '1',
    });

    expect(result.status).toBe(200);
    expect(git(dir, 'log', '-1', '--format=%an <%ae>|%s'))
      .toBe('Work User <work@example.invalid>|base amended');
  });

  test('a malformed identity is ignored, not passed to git', async () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git(dir, 'add', 'a.txt');
    await selectIdentity({ id: 'bad', name: 'Bad <User>', email: 'bad@example.invalid' });

    const result = await post({ root: dir, repo: '.', actionType: 'commit', message: 'feat: a' });

    expect(result.status).toBe(200);
    expect(git(dir, 'log', '-1', '--format=%an <%ae>'))
      .toBe('Test <test@example.invalid>');
  });
});
