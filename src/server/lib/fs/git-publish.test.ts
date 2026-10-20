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
 *
 * The pull suite also pins the DIVERGED case, where `--ff-only` exits 128 and
 * Sync silently did nothing (one local commit, one on origin) — see the merge
 * test and `pullBranch`'s own comment.
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

/** "<ahead>\t<behind>" against the upstream — `1\t1` is a diverged branch. */
function counts(cwd: string): string {
  return git(cwd, 'rev-list', '--count', '--left-right', 'HEAD...@{upstream}').trim();
}

/**
 * A second clone of `origin` that commits `name` and pushes it, so the branch
 * under test is behind by one — the other half of a divergence.
 *
 * `content` overrides what the file holds, which is what makes the two sides
 * CONFLICT instead of one of them being an unrelated new path.
 */
function pushFromOtherClone(origin: string, name: string, message: string, content?: string): void {
  const other = tempDir();
  git(tempDir(), 'clone', '-q', origin, other);
  initRepo(other);
  if (content === undefined) {
    commitFile(other, name, message);
  } else {
    fs.writeFileSync(path.join(other, name), content);
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', message);
  }
  git(other, 'push', '-q');
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

  /**
   * The reported Sync failure: one local commit and one on origin.
   *
   * `--ff-only` exits 128 here ("Not possible to fast-forward, aborting."), so
   * Sync threw before the push and the badge stayed at ↑1 ↓1 with git's advice
   * text on screen. The fix is the merge pull, and the assertion is the state
   * after a REAL push: nothing left ahead or behind.
   */
  test('merges a diverged branch instead of refusing, and the push then lands', async () => {
    const { origin, clone } = makeClone();
    pushFromOtherClone(origin, 'other.txt', 'other');
    commitFile(clone, 'mine.txt', 'mine');
    git(clone, 'fetch', '-q');
    expect(counts(clone)).toBe('1\t1');

    await pullBranch(clone);
    await pushBranch(clone);

    expect(counts(clone)).toBe('0\t0');
    // The merge commit carries the remote branch's name, which is what a pull
    // writes — not a rebase, whose history would hold two linear commits.
    expect(git(clone, 'log', '-1', '--pretty=%s')).toContain('Merge branch');
    expect(fs.existsSync(path.join(clone, 'other.txt'))).toBe(true);
  });

  /**
   * A pull that stops on a conflict exits 1 with `MERGE_HEAD` in place — the
   * state the operation bar exists to show, not a failed sync. Throwing there
   * reported the conflict as an error and never reached the panel's own
   * "resolve the conflicts" surface.
   */
  test('accepts a pull that stops on a conflict, leaving the merge open', async () => {
    const { origin, clone } = makeClone();
    // `seed.txt` exists on both sides already, so the two edits CONFLICT —
    // a file only one side has would merge cleanly (`AA` only when both
    // created it, which is a different shape than a content conflict).
    fs.writeFileSync(path.join(clone, 'seed.txt'), 'mine\n');
    git(clone, 'commit', '-q', '-am', 'mine');
    pushFromOtherClone(origin, 'seed.txt', 'theirs', 'theirs\n');
    git(clone, 'fetch', '-q');

    await pullBranch(clone);

    expect(fs.existsSync(path.join(clone, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(git(clone, 'status', '--porcelain=v1')).toContain('UU seed.txt');
  });

  /**
   * The pull is pinned to merge semantics whatever the repository's own
   * `pull.ff`/`pull.rebase` say — a Sync button must not mean two things.
   */
  test('does not inherit pull.ff=only, which reproduces the refusal', async () => {
    const { origin, clone } = makeClone();
    pushFromOtherClone(origin, 'other.txt', 'other');
    commitFile(clone, 'mine.txt', 'mine');
    git(clone, 'fetch', '-q');
    git(clone, 'config', 'pull.ff', 'only');

    await pullBranch(clone);

    // Ahead by the local commit plus the merge commit, and no longer behind:
    // the pull brought origin in rather than refusing it.
    expect(counts(clone)).toBe('2\t0');
    expect(git(clone, 'log', '-1', '--pretty=%s')).toContain('Merge branch');
  });
});
