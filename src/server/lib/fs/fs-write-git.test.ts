/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The filesystem writers, the cross-process lock, and git-backed discovery.
 *
 * `writeFileAtomic` exists for two silent failures: a rename that drops the
 * target's mode (loosening a 0600 secrets file to the umask) and a rename that
 * replaces a symlink with a regular file. Both are pinned here, along with the
 * all-or-nothing promise — a failed write must leave the original bytes and no
 * temp file behind.
 *
 * `withConfigLock` is the only thing serializing read-modify-write cycles, so
 * the tests cover the branches that decide correctness: acquire/release, a
 * stale lock (crashed holder) being broken, a live holder forcing the second
 * writer to wait, and the timeout. Waiting is driven by the lock file's own
 * existence and by event-loop yields, never by a guessed duration; the two
 * cases whose latency is the module's private constant (`LOCK_RETRY_MS`,
 * `LOCK_TIMEOUT_MS`) are the one place real wall-clock time is exercised.
 *
 * `git-repos` walks a TEMP tree (`git init` in a couple of subdirs) to pin the
 * pruning and depth rules that keep the walk bounded; `git-ignore` drives a
 * real `git check-ignore` against fixture `.gitignore` files to pin pattern,
 * negation and directory matching, plus the "not a repository" (exit 128)
 * non-answer.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileAtomic } from '@/server/lib/fs/atomic-write';
import { withConfigLock } from '@/server/lib/fs/config-lock';
import { discoveredRepos, rescanRepos, startRepoScan } from '@/server/lib/fs/git-repos';
import { collectIgnoredPaths } from '@/server/lib/fs/git-ignore';
import { testPosix } from '@/test-support/platform';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ompchamber-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/** Hand the event loop a turn without committing to any duration. */
function yieldLoop(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// The three `mode` cases are POSIX-only: Windows has no permission bits, so
// `statSync().mode` reports a synthesised `0o666`/`0o444` and every assertion
// about `0o644`/`0o600`/`0o640` fails on a platform that stores no such thing.
// The write behaviour itself is covered by the portable cases here.
describe('writeFileAtomic', () => {
  testPosix('a new file lands with the default mode', async () => {
    const target = join(tempDir('atomic'), 'fresh.txt');
    await writeFileAtomic(target, 'hello');
    expect(readFileSync(target, 'utf8')).toBe('hello');
    expect(statSync(target).mode & 0o777).toBe(0o644);
    expect(readdirSync(dirname(target)).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  testPosix('an existing 0600 file keeps its mode when replaced', async () => {
    const target = join(tempDir('atomic'), 'secret.yml');
    writeFileSync(target, 'old');
    chmodSync(target, 0o600);
    await writeFileAtomic(target, 'new');
    expect(readFileSync(target, 'utf8')).toBe('new');
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  testPosix('createMode applies only to a brand-new file', async () => {
    const dir = tempDir('atomic');
    const fresh = join(dir, 'created.txt');
    await writeFileAtomic(fresh, 'x', { createMode: 0o600 });
    expect(statSync(fresh).mode & 0o777).toBe(0o600);
    const existing = join(dir, 'existing.txt');
    writeFileSync(existing, 'x');
    chmodSync(existing, 0o640);
    await writeFileAtomic(existing, 'y', { createMode: 0o600 });
    expect(statSync(existing).mode & 0o777).toBe(0o640);
  });

  testPosix('writing through a symlink updates the target and keeps the link', async () => {
    const dir = tempDir('atomic');
    const real = join(dir, 'real.yml');
    const link = join(dir, 'link.yml');
    writeFileSync(real, 'old');
    symlinkSync(real, link);
    await writeFileAtomic(link, 'new');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe('new');
  });

  testPosix('a failed write leaves the original intact and no temp file', async () => {
    const dir = tempDir('atomic');
    const target = join(dir, 'config.yml');
    writeFileSync(target, 'original');
    chmodSync(dir, 0o500); // the temp file inside this directory cannot be created
    try {
      await expect(writeFileAtomic(target, 'replacement')).rejects.toThrow();
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(readFileSync(target, 'utf8')).toBe('original');
    expect(readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });
});

describe('withConfigLock', () => {
  // Only the PID-file FALLBACK is dropped: another suite forces it to exercise
  // its recovery branches, and it must not decide which mechanism runs here —
  // while a real host may be held by a lease a sibling suite still owns.
  beforeEach(() => {
    const host = globalThis as { __ompChamberFlock?: { available?: boolean } };
    if (host.__ompChamberFlock?.available === false) delete host.__ompChamberFlock;
  });

  test('runs the critical section, returns its value, removes the lock', async () => {
    const configPath = join(tempDir('lock'), 'config.json');
    const lockPath = `${configPath}.lock`;
    let observed: string | null = null;
    const value = await withConfigLock<number>(configPath, () => {
      observed = readFileSync(lockPath, 'utf8');
      return 42;
    });
    expect(value).toBe(42);
    expect<string | null>(observed).toBe(String(process.pid));
    expect(existsSync(lockPath)).toBe(false);
  });

  test('a stale lock from a crashed holder is broken', async () => {
    const configPath = join(tempDir('lock'), 'stale.json');
    const lockPath = `${configPath}.lock`;
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, '99999');
    const old = (Date.now() - 20_000) / 1000;
    utimesSync(lockPath, old, old);
    expect(await withConfigLock(configPath, () => 'ok')).toBe('ok');
    expect(existsSync(lockPath)).toBe(false);
  });

  test('a live holder makes the second writer wait for it, then both run', async () => {
    const configPath = join(tempDir('lock'), 'contended.json');
    const order: string[] = [];
    const gateA = Promise.withResolvers<void>();
    const first = withConfigLock(configPath, async () => {
      order.push('a-start');
      await gateA.promise;
      order.push('a-end');
      return 'A';
    });
    // Wait for `first` to be INSIDE its critical section, not for the lockfile:
    // the file is created by `open` and the holder's pid reaches it only after
    // `writeFile` + `close` have drained, which takes hundreds of event-loop
    // turns on a loaded host. Watching the lockfile therefore returned while
    // `a-start` had not run, and the later assertion saw an empty `order`.
    for (let i = 0; i < 50_000 && order.length === 0; i += 1) await yieldLoop();
    expect(order).toEqual(['a-start']);

    const second = withConfigLock(configPath, () => {
      order.push('b');
      return 'B';
    });
    // `first` holds the lock until `gateA` resolves, so `b` must not appear —
    // the wait below only gives `second` a chance to run, and the final order
    // is what proves mutual exclusion.
    for (let i = 0; i < 200; i += 1) await yieldLoop();
    expect(order).toEqual(['a-start']);

    gateA.resolve();
    expect(await first).toBe('A');
    expect(await second).toBe('B');
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });

  // Real wall-clock latency: `LOCK_TIMEOUT_MS` is a private constant with no
  // injection point, and the timeout IS the behaviour under test.
  test('a held lock times out with a named error', async () => {
    const configPath = join(tempDir('lock'), 'held.json');
    const lockPath = `${configPath}.lock`;
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, String(process.pid));
    await expect(withConfigLock(configPath, () => 'never')).rejects.toThrow(/Timed out waiting for/);
  });
});

describe('git-repos discovery', () => {
  /** `git init` so the walk can see a `.git` entry in `dir`. */
  const gitInit = (dir: string): void => {
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: dir });
  };

  /** The walk runs in the background; yield until it reports completion. */
  async function settled(root: string): Promise<{ repos: string[]; pending: boolean }> {
    for (let i = 0; i < 20_000; i += 1) {
      const state = discoveredRepos(root);
      if (!state.pending) return state;
      await yieldLoop();
    }
    throw new Error(`repo scan for ${root} did not settle`);
  }

  test('finds nested repos, skips plain dirs and prunes node_modules', async () => {
    const root = tempDir('repos');
    gitInit(join(root, 'alpha'));
    gitInit(join(root, 'beta'));
    mkdirSync(join(root, 'plain'), { recursive: true });
    gitInit(join(root, 'node_modules', 'vendored'));

    startRepoScan(root);
    // The loader answers before the walk finishes, hence `pending`.
    expect(discoveredRepos(root)).toEqual({ repos: ['.'], pending: true });

    const { repos, pending } = await settled(root);
    expect(pending).toBe(false);
    expect(repos).toContain('alpha');
    expect(repos).toContain('beta');
    expect(repos).not.toContain('plain');
    expect(repos.some((repo) => repo.includes('node_modules'))).toBe(false);
  });

  test('a root that is itself a repo lists `.` first', async () => {
    const root = tempDir('repos');
    gitInit(root);
    gitInit(join(root, 'inner'));
    startRepoScan(root);
    const { repos } = await settled(root);
    expect(repos[0]).toBe('.');
    expect(repos).toContain('inner');
  });

  test('a tree with no repo reports `.` and is not pending', async () => {
    const root = tempDir('repos');
    mkdirSync(join(root, 'plain'), { recursive: true });
    startRepoScan(root);
    expect(await settled(root)).toEqual({ repos: ['.'], pending: false });
    expect(discoveredRepos(join(root, 'never-scanned'))).toEqual({ repos: ['.'], pending: false });
  });

  test('the walk stops at MAX_GIT_DEPTH', async () => {
    const root = tempDir('repos');
    const seven = join(root, ...Array(7).fill('d'));
    gitInit(seven);
    gitInit(join(seven, 'd')); // depth 8 — past the bound

    startRepoScan(root);
    const { repos } = await settled(root);
    expect(repos).toContain(Array(7).fill('d').join('/'));
    expect(repos.some((repo) => repo.split('/').length === 8)).toBe(false);
  });

  test('rescan picks up a repo created after the first walk', async () => {
    const root = tempDir('repos');
    gitInit(join(root, 'one'));
    startRepoScan(root);
    await settled(root);
    gitInit(join(root, 'two'));
    rescanRepos(root);
    expect((await settled(root)).repos).toContain('two');
  });
});

describe('collectIgnoredPaths', () => {
  test('no paths means no git call and an empty answer', async () => {
    expect(await collectIgnoredPaths(tempDir('ignore'), [])).toEqual(new Set());
  });

  test('patterns, negation and directory patterns match what git refuses', async () => {
    const dir = tempDir('ignore');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), 'build/\n*.log\n!keep.log\n');
    mkdirSync(join(dir, 'build'), { recursive: true });
    writeFileSync(join(dir, 'build', 'x.txt'), '');
    writeFileSync(join(dir, 'a.log'), '');
    writeFileSync(join(dir, 'keep.log'), '');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.ts'), '');

    const ignored = await collectIgnoredPaths(dir, ['build/x.txt', 'a.log', 'keep.log', 'src/main.ts']);
    expect(ignored.has('build/x.txt')).toBe(true); // directory pattern
    expect(ignored.has('a.log')).toBe(true); // extension pattern
    expect(ignored.has('keep.log')).toBe(false); // negated
    expect(ignored.has('src/main.ts')).toBe(false);
  });

  test('a non-repository (exit 128) is not cached as an answer', async () => {
    const dir = tempDir('ignore');
    writeFileSync(join(dir, 'a.log'), '');
    expect(await collectIgnoredPaths(dir, ['a.log'])).toEqual(new Set());
    // Same path, now inside a repository with a rule that matches it: had the
    // 128 answer been cached, this would still be empty.
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), '*.log\n');
    expect((await collectIgnoredPaths(dir, ['a.log'])).has('a.log')).toBe(true);
  });

  test('an answer is cached for the TTL, so a just-edited rule is briefly stale', async () => {
    const dir = tempDir('ignore');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), '*.log\n');
    writeFileSync(join(dir, 'a.log'), '');
    expect((await collectIgnoredPaths(dir, ['a.log'])).has('a.log')).toBe(true);
    rmSync(join(dir, '.gitignore'));
    // Within the 5s TTL the memoized "ignored" answer is still returned.
    expect((await collectIgnoredPaths(dir, ['a.log'])).has('a.log')).toBe(true);
  });
});
