/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Publishing one branch, on the branch a user is most likely to be on: one just
 * created locally.
 *
 * Both naive commands fail there, and both failures were real. `git push` exits
 * 128 ("has no upstream branch"), so Sync could not send the commits the badge
 * was counting. `git pull --ff-only` exits 1 ("no tracking information") — a
 * refusal, not a failure — and treating it as an error aborted Sync before it
 * ever reached the push. Driven against real repositories, because the exit
 * codes and the `-u` upstream write are what the module exists for.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pullBranch, pushBranch } from '@/server/lib/fs/git-publish';
import { removeDir } from '@/test-support/remove-dir';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-gitpub-'));
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

function commitFile(cwd: string, name: string, message: string): void {
  fs.writeFileSync(path.join(cwd, name), `${name}\n`);
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

function upstreamOf(cwd: string): string {
  return git(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').trim();
}

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

describe('pushBranch', () => {
  test('publishes a fresh local branch and sets its upstream', async () => {
    const { origin, clone } = makeClone();
    git(clone, 'checkout', '-q', '-b', 'feat/x');
    commitFile(clone, 'one.txt', 'one');

    await pushBranch(clone);

    expect(upstreamOf(clone)).toBe('origin/feat/x');
    // The remote really holds it — an upstream set without a push would be a
    // local-only ref and the next count would still read as unpushed.
    expect(git(clone, 'ls-remote', '--heads', origin, 'feat/x')).toContain('feat/x');
  });

  test('pushes a branch that already tracks, without re-pointing it', async () => {
    const { clone } = makeClone();
    commitFile(clone, 'more.txt', 'more');

    await pushBranch(clone);

    expect(upstreamOf(clone)).toBe('origin/main');
  });

  test('names the missing remote instead of pushing nowhere', async () => {
    const repo = tempDir();
    initRepo(repo);
    commitFile(repo, 'a.txt', 'a');

    await expect(pushBranch(repo)).rejects.toThrow(/no remote/i);
  });

  test('uses the repository\'s own remote, not a hardcoded origin', async () => {
    const { origin, clone } = makeClone();
    git(clone, 'remote', 'rename', 'origin', 'upstream');
    git(clone, 'checkout', '-q', '-b', 'feat/z');
    commitFile(clone, 'z.txt', 'z');

    await pushBranch(clone);

    expect(upstreamOf(clone)).toBe('upstream/feat/z');
    expect(git(clone, 'ls-remote', '--heads', origin, 'feat/z')).toContain('feat/z');
  });
});

describe('pullBranch', () => {
  test('stands down on a branch with no upstream instead of failing', async () => {
    const { clone } = makeClone();
    git(clone, 'checkout', '-q', '-b', 'feat/new');
    commitFile(clone, 'n.txt', 'n');

    // The command this replaces exited 1 here, which aborted Sync before push.
    // Reaching the next line at all is the assertion; the rev-parse below is
    // read through the raw runner because it is EXPECTED to exit non-zero.
    await pullBranch(clone);

    const upstream = Bun.spawnSync({
      cmd: ['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      cwd: clone,
    });
    expect(upstream.exitCode).not.toBe(0);
  });

  test('fast-forwards a tracking branch', async () => {
    const { origin, clone } = makeClone();
    const work = tempDir();
    git(tempDir(), 'clone', '-q', origin, work);
    initRepo(work);
    commitFile(work, 'remote.txt', 'remote');
    git(work, 'push', '-q');

    await pullBranch(clone);

    expect(fs.existsSync(path.join(clone, 'remote.txt'))).toBe(true);
  });
});
