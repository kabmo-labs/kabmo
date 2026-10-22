/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `sync` ACTION, not just the pull under it.
 *
 * `pullBranch` is pinned by `git-publish.test.ts`; what is pinned here is the
 * handler's own two rules, both invisible from the pull alone:
 *
 * - A pull that stops on a conflict SKIPS the push. `git push` refuses while
 *   the merge is unresolved, so without the skip the route answered 400 over a
 *   conflict the operation bar was about to offer to resolve — the reported
 *   "Sync failed" on the exact state the panel has a surface for.
 * - A tree already in an operation is refused BY NAME rather than by git's
 *   "You have not concluded your merge" — the panel can only act on an
 *   operation it knows about, and an error that names it is what points the
 *   user at the bar.
 *
 * Driven against real repositories: the exit codes, the merge commit and the
 * `MERGE_HEAD` file are the whole subject.
 */

import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GIT_BRANCH_ACTIONS } from '@/server/lib/fs/git-actions-branch';
import { removeDir } from '@/test-support/remove-dir';

/**
 * The suite drives REAL git processes — `init`, `clone`, `commit`, `push`,
 * `fetch`, `pull`, `merge` — and one test of it pays for most of them. Bun's
 * default per-test budget is 5s, which a Linux runner clears and a Windows
 * runner does not: measured on `windows-latest`, "reconciles a diverged branch"
 * timed out at 5001ms while the same suite is green locally in 1.4s. Process
 * spawn on that runner costs several times what it does on POSIX, and the
 * log line above the failure (`killed 1 dangling process`) is the timeout
 * firing mid-`git`.
 *
 * A budget, not a skip: the behaviour — a diverged branch reconciled by a merge
 * and then pushed — is identical on both platforms, and skipping it there would
 * report the Sync button as unverified on a platform the CLI ships to. The same
 * budget is stated for the same reason in `git-update.server.test.ts`.
 */
setDefaultTimeout(30_000);

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-gitsync-action-'));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function initRepo(cwd: string): void {
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@example.invalid');
  git(cwd, 'config', 'user.name', 'Test');
}

function commitFile(cwd: string, name: string, message: string, content?: string): void {
  fs.writeFileSync(path.join(cwd, name), content ?? `${name}\n`);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
}

/** A bare origin plus a clone tracking it, each on its own temp path. */
function makeClone(): { origin: string; clone: string } {
  const origin = tempDir();
  git(origin, 'init', '-q', '--bare', '-b', 'main');
  const clone = tempDir();
  git(tempDir(), 'clone', '-q', origin, clone);
  initRepo(clone);
  commitFile(clone, 'seed.txt', 'seed');
  git(clone, 'push', '-q', '-u', 'origin', 'main');
  return { origin, clone };
}

/** Commit `name` in a second clone of `origin` and push it. */
function pushFromOtherClone(origin: string, name: string, message: string, content?: string): void {
  const other = tempDir();
  git(tempDir(), 'clone', '-q', origin, other);
  initRepo(other);
  commitFile(other, name, message, content);
  git(other, 'push', '-q');
}

function counts(cwd: string): string {
  return git(cwd, 'rev-list', '--count', '--left-right', 'HEAD...@{upstream}').trim();
}

/** One sync, through the same handler the route dispatches. */
async function sync(cwd: string): Promise<void> {
  const handler = GIT_BRANCH_ACTIONS.sync;
  await handler({ formData: new FormData(), targetDir: cwd });
}

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

describe('the sync action', () => {
  test('reconciles a diverged branch and publishes the result', async () => {
    const { origin, clone } = makeClone();
    pushFromOtherClone(origin, 'other.txt', 'other');
    commitFile(clone, 'mine.txt', 'mine');
    git(clone, 'fetch', '-q');
    expect(counts(clone)).toBe('1\t1');

    await sync(clone);

    // Both sides landed and the remote has them: nothing ahead or behind.
    expect(counts(clone)).toBe('0\t0');
    expect(fs.existsSync(path.join(clone, 'other.txt'))).toBe(true);
    expect(git(clone, 'log', '-1', '--pretty=%s')).toContain('Merge branch');
  });

  test('leaves a conflicted merge open and does not push over it', async () => {
    const { origin, clone } = makeClone();
    commitFile(clone, 'seed.txt', 'mine', 'mine\n');
    pushFromOtherClone(origin, 'seed.txt', 'theirs', 'theirs\n');
    git(clone, 'fetch', '-q');

    // The pull exits 1 with MERGE_HEAD in place; the handler must treat that as
    // the state to show, not as a failure.
    await sync(clone);

    expect(fs.existsSync(path.join(clone, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(git(clone, 'status', '--porcelain=v1')).toContain('UU seed.txt');
  });

  test('refuses by name while an operation is already in progress', async () => {
    const { origin, clone } = makeClone();
    commitFile(clone, 'seed.txt', 'mine', 'mine\n');
    pushFromOtherClone(origin, 'seed.txt', 'theirs', 'theirs\n');
    git(clone, 'fetch', '-q');
    // Start the merge the way the panel does, then try to sync over it.
    Bun.spawnSync({ cmd: ['git', 'merge', '--no-edit', '--', '@{upstream}'], cwd: clone });
    expect(fs.existsSync(path.join(clone, '.git', 'MERGE_HEAD'))).toBe(true);

    // `expect(...).rejects` is typed as returning void by Bun's matcher types,
    // so awaiting it is a no-op — the explicit catch is what actually waits.
    let refusal = '';
    try {
      await sync(clone);
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    expect(refusal).toMatch(/finish the merge first/i);
  });
});
