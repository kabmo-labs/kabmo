/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `init` action — the one action reachable on a folder with no repository,
 * and the reason `readGitStatus` reports `isRepo` at all.
 *
 * Split from `git-action.test.ts`: the two files together exceeded the repo's
 * line ceiling, and this one needs fixtures the others do not (a directory that
 * is not a repository at all).
 *
 * The guard matters as much as the verb: `git init` on an existing repository
 * prints "Reinitialized existing Git repository" and exits 0, so a stale client
 * (the button survives until the next status read lands) would be told it created
 * something it did not — and inside another repository's subtree it would create
 * a second, nested one.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { action } from '@/server/routes/fs/git';
import { GIT_ACTIONS } from '@/server/lib/fs/git-actions';
import { removeDir } from '@/test-support/remove-dir';

/**
 * Scratch fixtures under a directory this file owns, inside the app root — the
 * route's allow-list (`resolveRoot` accepts the app root, a path beneath it, or a
 * registered workspace) substitutes the app root for anything else, which would
 * run git against the Kabmo repository itself.
 */
const FIXTURE_ROOT = path.join(process.cwd(), 'tmp-test-git-init');
const scratch: string[] = [];

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
}

/** A fresh directory under the fixture root (a repository only if `makeRepo` says so). */
function makeDir(): string {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const base = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'work-'));
  scratch.push(base);
  const dir = path.join(base, 'work');
  fs.mkdirSync(dir);
  return dir;
}

/** A fresh repository with one commit. */
function makeRepo(): string {
  const dir = makeDir();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

/** POST one action through the route, reading its operands from the form body. */
async function post(fields: Record<string, string>): Promise<{ status: number; body: { success?: boolean; error?: string } }> {
  if (!(fields.root ?? '').startsWith(FIXTURE_ROOT + path.sep)) {
    throw new Error(`refusing to run a git action outside the fixture root: ${fields.root}`);
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await action({
    request: new Request('http://localhost/api/fs/git', { method: 'POST', body: form }),
  } as never);
  return { status: response.status, body: (await response.json()) as { success?: boolean; error?: string } };
}

afterAll(() => {
  for (const dir of scratch) removeDir(dir);
  removeDir(FIXTURE_ROOT);
});

describe('init', () => {
  test('creates a repository in a folder that has none', async () => {
    // OUTSIDE the app root on purpose: every fixture under it sits inside the
    // Kabmo checkout's own repository — which is the case the last test refuses.
    // So the happy path drives the registered handler directly, in a directory
    // git genuinely knows nothing about.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-init-'));
    try {
      await GIT_ACTIONS.init({ formData: new FormData(), targetDir: dir });
      expect(fs.existsSync(path.join(dir, '.git'))).toBe(true);
      expect(Bun.spawnSync({ cmd: ['git', 'rev-parse', '--git-dir'], cwd: dir }).exitCode).toBe(0);
    } finally {
      removeDir(dir);
    }
  });

  test('refuses a folder that already is a repository', async () => {
    const repo = makeRepo();

    const res = await post({ actionType: 'init', repo: '.', root: repo });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Already a Git repository');
  });

  /**
   * The nested case, only reachable THROUGH the route: a folder inside another
   * repository resolves that enclosing one, so `init` would create a second
   * repository inside the first. The panel never offers the button there
   * (`git status` succeeds, so the read reports `isRepo: true`), but the guard is
   * the server's, not the panel's render state.
   */
  test('refuses a folder inside another repository rather than nesting one', async () => {
    const dir = makeDir();

    const res = await post({ actionType: 'init', repo: '.', root: dir });

    expect(res.status).toBe(400);
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false);
  });
});
