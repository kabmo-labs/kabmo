/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A git READ must not take `.git/index.lock`, because the panel reads and
 * writes the same repository concurrently.
 *
 * `git status` looks read-only and is not. With a STALE index — a working file
 * whose mtime is newer than the stat the index recorded, which is the normal
 * state right after a checkout, a merge, or any tool that wrote files — git
 * refreshes the index and WRITES IT BACK (`do_write_index` in `read-cache.c`,
 * writing `<repo>/.git/index.lock`), which is why the panel's reads race its own
 * merges. Measured on git 2.50: `GIT_TRACE2_EVENT=1 git status` on a stale index
 * records `do_write_index … index.lock` twice, and the same command with
 * `GIT_OPTIONAL_LOCKS=0` records it ZERO times. Under concurrency the loser of
 * the race is the merge:
 *
 *   git action merge_branch failed (HTTP 400): error: Unable to create
 *   '<repo>/.git/index.lock': File exists.
 *
 * That is a real failure on a user's machine, not a flaky test: it fired twice
 * in the browser specs (2026-10-15 and 2026-10-16) and needs only the repository
 * modal to be open while a merge is clicked.
 *
 * `GIT_OPTIONAL_LOCKS=0` is git's own answer for a read — the index refresh is
 * an optimization (it lets the next read skip re-stat'ing), so declining it
 * costs a stat and removes the write. This test drives the REAL `runGit` and the
 * REAL status read against a real repository, because the whole bug lives in the
 * spawn environment: a fake child would prove nothing about which variables git
 * was given.
 *
 * The assertion is the index FILE's identity (mtime + size), not a race: git
 * either replaced it or it did not. The race itself is deliberately NOT
 * asserted — measured, spawning the reads and the merge together does not
 * reproduce it reliably enough to be a test (0 of 6 runs failed with the fix
 * reverted), and a test that passes with the bug present is worse than no test.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGit } from '@/server/lib/fs/git-run';
import { readGitStatus } from '@/server/lib/fs/git-status-read';
import { testPosix } from '@/test-support/platform';

const repos: string[] = [];

afterEach(() => {
  while (repos.length > 0) fs.rmSync(repos.pop() as string, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    cwd,
    env: { ...Bun.env, GIT_EDITOR: 'true' },
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-index-lock-'));
  repos.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'e2e@example.invalid');
  git(dir, 'config', 'user.name', 'E2E');
  return dir;
}

/** One commit of `files` tracked files, so a changed stat below makes the index stale. */
function seedTracked(cwd: string, files = 200): void {
  for (let i = 0; i < files; i += 1) {
    fs.writeFileSync(path.join(cwd, `f${i}.txt`), `line ${i}\n`);
  }
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'base');
}

/**
 * Make the index STAT-STALE without changing any file's content: every tracked
 * file's mtime is moved well ahead of the stat the index recorded.
 *
 * **The content must stay identical, and that is the whole point.** `git status`
 * only writes the index back when it can REFRESH an entry (`cache_changed`), and
 * an entry whose CONTENT changed is dirty — git cannot refresh it, so the write
 * then depends on `has_racy_timestamp` instead: the index's own mtime second
 * against the entry's recorded one. That is a clock race against the fixture's
 * setup, and it is what made this control flake (measured on macOS: every run
 * whose `git add`/`git commit` stayed inside one second wrote the index, and the
 * one run that crossed a second boundary did not — `git status` reported the
 * same 200 modified files either way). Touching the mtime with the content
 * intact makes the refresh SUCCEED, so `cache_changed` is set on every git build
 * and every platform, independent of timestamps.
 *
 * The mtime is moved EXPLICITLY rather than left to "the rewrite happens after
 * the commit". Those differ by filesystem timestamp granularity: on a runner
 * whose clock or FS rounds to the second, a rewrite inside the same second as
 * the index write leaves the entry "racily clean". A minute of headroom is
 * unambiguous on every filesystem git supports, and each call takes a larger
 * offset so a second pass is stale against the stat the first one wrote back.
 */
function staleIndex(cwd: string, secondsAhead: number, files = 200): void {
  for (let i = 0; i < files; i += 1) {
    const file = path.join(cwd, `f${i}.txt`);
    const future = new Date(Date.now() + secondsAhead * 1000);
    fs.utimesSync(file, future, future);
  }
}

/** The index's identity: git replaces it atomically, so either field moves. */
function indexStamp(cwd: string): string {
  const stat = fs.statSync(path.join(cwd, '.git', 'index'));
  return `${stat.mtimeMs}:${stat.size}`;
}

/**
 * Whether a `git status` run rewrote the index — i.e. took the lock.
 *
 * Read from the index FILE rather than from git's `GIT_TRACE2_EVENT` stream.
 * The trace was the original probe and it is version- and platform-sensitive:
 * the region name (`do_write_index`) is an implementation detail, git-for-Windows
 * does not emit it at all, and a `trace2` config in the environment can redirect
 * the stream away from stderr. The file is the thing the assertion is actually
 * about — `index.lock` is taken so the index can be replaced — and it is
 * observable on every platform and version.
 */
function indexWriteCount(cwd: string, env: Record<string, string>): number {
  const before = indexStamp(cwd);
  const result = Bun.spawnSync({
    cmd: ['git', 'status', '--porcelain'],
    cwd,
    env: { ...Bun.env, ...env },
  });
  // A failed run proves nothing either way; the caller's assertion would read a
  // crash as "no write", which is the vacuous pass this control exists to stop.
  if (result.exitCode !== 0) throw new Error(`git status failed: ${result.stderr.toString()}`);
  return indexStamp(cwd) === before ? 0 : 1;
}

describe('a git READ does not take the index lock', () => {
  // The positive control watches the INDEX FILE, which is what the lock exists
  // to replace. That keeps it meaningful on every git version and platform; the
  // `testPosix` guard stays because the shim-based case below writes a `#!/bin/sh`
  // stub, which Windows cannot execute.
  testPosix('git status writes the index on a stale index — and stops when the lock is refused', () => {
    // The mechanism itself, so the rest of the test cannot pass vacuously: if a
    // future git stops refreshing the index here, this assertion fails and says
    // so rather than silently proving nothing.
    const repo = makeRepo();
    seedTracked(repo);
    staleIndex(repo, 60);
    expect(indexWriteCount(repo, {})).toBeGreaterThan(0);

    staleIndex(repo, 120);
    expect(indexWriteCount(repo, { GIT_OPTIONAL_LOCKS: '0' })).toBe(0);
  });

  testPosix('Kabmo spawns git with the lock refused, on both the argv and the shell path', async () => {
    // The status read goes through `runShell` (a `sh -c` string), the repo-modal
    // read through `runGit` (argv) — the split is exactly how one of the two
    // paths would have kept the bug. A shim on PATH records what each child was
    // actually given.
    //
    // **The shim is only reached by a spawn that passes `env:`** — measured:
    // `Bun.spawn` with no `env` option resolves the command against the
    // environment captured at process start, so a shim added to `process.env`
    // afterwards is invisible to it. That is not a limitation to work around, it
    // IS the signal: a call site that drops its `env` is a call site the shim
    // never sees, which is why each path is asserted BY ITS OWN ARGUMENTS rather
    // than by a total count.
    //
    // The real git is resolved BEFORE the shim goes on PATH, and the shim execs
    // that absolute path: a bare `git` inside the shim would find the shim again
    // and recurse (measured: the fixture's own `git init` timed out).
    const realGit = Bun.which('git');
    expect(realGit).toBeTruthy();

    // The repository is built FIRST, while the real git is still the one on
    // PATH — the fixture's own `git init`/`commit` calls do not set the variable
    // and would otherwise be recorded as misses.
    const repo = makeRepo();
    seedTracked(repo);

    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-git-shim-'));
    repos.push(shimDir);
    const record = path.join(shimDir, 'env.txt');
    const shim = path.join(shimDir, 'git');
    fs.writeFileSync(
      shim,
      `#!/bin/sh\nprintf 'locks=%s argv=%s\\n' "\${GIT_OPTIONAL_LOCKS-unset}" "$*" >> ${JSON.stringify(record)}\nexec ${JSON.stringify(realGit)} "$@"\n`,
      { mode: 0o755 },
    );

    const previousPath = process.env.PATH;
    process.env.PATH = `${shimDir}:${previousPath ?? ''}`;
    try {
      // The shell path: the status read the panel runs on every tool call.
      await readGitStatus(repo);
      // The argv path, with its own format so the two cannot be confused in the
      // record.
      await runGit(['status', '--porcelain=v2'], { cwd: repo });

      const lines = fs.readFileSync(record, 'utf8').trim().split('\n');
      const shell = lines.filter((line) => line.includes('--porcelain=v1'));
      const argv = lines.filter((line) => line.includes('--porcelain=v2'));
      // Both paths reached the shim at all — this is what fails when a call site
      // stops passing its environment.
      expect(shell.length).toBeGreaterThan(0);
      expect(argv.length).toBeGreaterThan(0);
      // And every spawn refused the lock.
      expect(lines.every((line) => line.startsWith('locks=0 '))).toBe(true);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  test('a mutating command still writes the index with the variable set', async () => {
    // The lock is a READ concern. A commit that skipped it would be broken, so
    // this pins that the variable does not disarm a writer.
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'x\n');
    const add = await runGit(['add', 'a.txt'], { cwd: repo });
    expect(add.exitCode).toBe(0);
    const commit = await runGit(['commit', '-q', '-m', 'add a'], { cwd: repo });
    expect(commit.exitCode).toBe(0);
    expect(git(repo, 'log', '--oneline', '-1')).toContain('add a');
  });
});
