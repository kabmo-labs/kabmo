/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The wiki read path is a git spawn plus a cache, and both fail silently when
 * they are wrong: a wiki path with a space that reaches a shell as a string is
 * mangled, a credential prompt with no terminal to answer it hangs the read to
 * its timeout, and a mirror keyed by the remote URL rather than by host+slug
 * would fetch the same wiki twice under its https and ssh spellings. These
 * tests pin the argv/env shape of `gitRun` and the four ways a fetch is
 * classified; the reads that come back out of the mirror are `mirror-reads`.
 *
 * No network: `git` is replaced by a compiled stub on PATH (`@/test-support/
 * fake-git`), which starts on Windows too.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { firstLine, gitRun } from '@/server/lib/wiki/git';
import { detectWikiProvider } from '@/server/lib/wiki/provider.server';
import { testPosix } from '@/test-support/platform';
import {
  cleanupFakeGit,
  FAKE_GIT_ENV_KEYS,
  fakeGitTempDir,
  gitCalls,
  realPath,
  useFakeGit,
} from '@/test-support/fake-git';
import { ensureWikiMirror } from '@/server/lib/wiki/mirror.server';

/** Point the mirror cache at a throwaway data directory. */
function useWikiDataDir(): void {
  process.env.KABMO_DATA_DIR = fakeGitTempDir('omp-wiki-data-');
}

afterEach(() => {
  process.env.PATH = realPath;
  globalThis.__kabmoWikiCache = undefined;
  globalThis.__kabmoWikiProviders = undefined;
  for (const key of FAKE_GIT_ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  delete process.env.KABMO_DATA_DIR;
  cleanupFakeGit();
});

describe('gitRun', () => {
  test('passes every argument as argv, so no shell can rewrite a path', async () => {
    await useFakeGit();

    const result = await gitRun(['log', 'Setting up notes.md', 'a b"c$d'], { timeoutMs: 5_000 });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n').filter(Boolean)).toEqual(['log', 'Setting up notes.md', 'a b"c$d', 'ENV=0']);
  });

  test('sets GIT_TERMINAL_PROMPT=0 so a private wiki cannot block on a prompt', async () => {
    await useFakeGit();

    const result = await gitRun(['fetch', 'origin'], { timeoutMs: 5_000 });

    expect(result.stdout).toContain('ENV=0');
  });

  test('reports a real git version with a zero exit code', async () => {
    const result = await gitRun(['--version'], { timeoutMs: 5_000 });

    expect(result.failed).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith('git version')).toBe(true);
  });

  test('reports a process that could not start as failed with no exit code', async () => {
    const result = await gitRun(['--version'], { cwd: join(tmpdir(), 'omp-missing-cwd-xyz'), timeoutMs: 5_000 });

    expect(result.failed).toBe(true);
    expect(result.exitCode).toBe(null);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  // POSIX-only: the case asserts that a CHILD killed by a signal is reported as
  // failed, and Windows has no signals — `TerminateProcess` reports an ordinary
  // exit code with `signalCode` null. The portable half of the same rule (our own
  // timeout kill) is the case below, which is detected by a flag rather than by
  // `signalCode` for exactly this reason.
  testPosix('reports a signalled process as failed', async () => {
    await useFakeGit();
    process.env.FAKE_GIT_SIGNAL = 'TERM';

    const result = await gitRun(['log'], { timeoutMs: 5_000 });

    expect(result.failed).toBe(true);
  });

  // Portable, and the half that Windows needs: the budget is enforced by a kill
  // WE perform, so the failure is a flag we set rather than a `signalCode` only
  // POSIX reports. Without it a timed-out `git` on Windows reads as a success
  // and the wiki fetch is cached as an empty mirror.
  test('reports a process that outlived its budget as failed on every platform', async () => {
    await useFakeGit();
    process.env.FAKE_GIT_SLEEP = '5000';

    const started = Date.now();
    const result = await gitRun(['log'], { timeoutMs: 200 });

    expect(result.failed).toBe(true);
    expect(Date.now() - started).toBeLessThan(4_000);
  });
});

describe('firstLine', () => {
  test('keeps only the first trimmed line of git output', () => {
    expect(firstLine('  fatal: nope  \nsecond line\n')).toBe('fatal: nope');
    expect(firstLine('only')).toBe('only');
    expect(firstLine('')).toBe('');
    expect(firstLine('\n\n')).toBe('');
  });
});

// Portable: `byName` answers the two public hosts without a request, and the
// probe for an unknown host is a `fetch`, not a `git` spawn — so nothing here
// reaches the compiled stub the rest of this file needs.
describe('detectWikiProvider', () => {
  test('decides the two public hosts by name, with no request', async () => {
    for (const host of ['github.com', 'GitHub.com', 'www.github.com']) {
      expect(await detectWikiProvider(host)).toBe('github');
    }
    for (const host of ['gitlab.com', 'sub.gitlab.com', 'gitlab.example.com', 'my-gitlab-host.io']) {
      expect(await detectWikiProvider(host)).toBe('gitlab');
    }
  });

  test('uses a cached verdict for an unknown host instead of probing again', async () => {
    globalThis.__kabmoWikiProviders = {
      hosts: new Map([['probe.example.test', { provider: 'gitlab', at: Date.now() }]]),
    };

    expect(await detectWikiProvider('probe.example.test')).toBe('gitlab');
  });
});

describe('ensureWikiMirror', () => {
  test('fetches into a bare mirror keyed by host and slug', async () => {
    await useFakeGit();
    useWikiDataDir();

    const result = await ensureWikiMirror('github.com', 'o/n', 'https://github.com/o/n.wiki.git');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mirror).toEqual({
      repoDir: join(process.env.KABMO_DATA_DIR as string, 'wiki', 'github.com__o__n'),
      revision: 'abc123',
      updatedAt: '2026-01-02T03:04:05Z',
    });
    expect(gitCalls().filter((args) => args[2] === 'fetch')).toEqual([
      [
        '--git-dir',
        result.mirror.repoDir,
        'fetch',
        '--no-write-fetch-head',
        '--depth',
        '1',
        '--force',
        '--quiet',
        'https://github.com/o/n.wiki.git',
        'HEAD:refs/wiki/latest',
      ],
    ]);
  });

  test('shares one mirror between the https and ssh spellings of a remote', async () => {
    await useFakeGit();
    useWikiDataDir();

    const first = await ensureWikiMirror('gitlab.com', 'g/p', 'https://gitlab.com/g/p.wiki.git');
    const second = await ensureWikiMirror('gitlab.com', 'g/p', 'git@gitlab.com:g/p.wiki.git');
    expect(first.ok && second.ok).toBe(true);
    expect(gitCalls().filter((args) => args[2] === 'fetch')).toHaveLength(1);

    const forced = await ensureWikiMirror('gitlab.com', 'g/p', 'git@gitlab.com:g/p.wiki.git', true);
    expect(forced.ok).toBe(true);
    const fetches = gitCalls().filter((args) => args[2] === 'fetch');
    expect(fetches).toHaveLength(2);
    expect(fetches[1]?.[8]).toBe('git@gitlab.com:g/p.wiki.git');
  });

  test('classifies a missing repository as no-wiki', async () => {
    await useFakeGit();
    useWikiDataDir();
    process.env.FAKE_GIT_FETCH_FAIL =
      "remote: Repository not found.\nfatal: repository 'https://github.com/o/n.wiki.git/' not found";

    const result = await ensureWikiMirror('missing.test', 'o/n', 'https://missing.test/o/n.wiki.git');

    expect(result).toEqual({ ok: false, reason: 'no-wiki', detail: 'remote: Repository not found.' });
  });

  test('classifies a transport failure as unreachable', async () => {
    await useFakeGit();
    useWikiDataDir();
    process.env.FAKE_GIT_FETCH_FAIL = "fatal: unable to access 'https://x/': Could not resolve host: x";

    const result = await ensureWikiMirror('other.test', 'o/n', 'https://other.test/o/n.wiki.git');

    expect(result).toEqual({
      ok: false,
      reason: 'unreachable',
      detail: "fatal: unable to access 'https://x/': Could not resolve host: x",
    });
  });

  // POSIX-only for the same reason as `reports a signalled process as failed`:
  // the stub kills ITSELF with SIGTERM, which Windows cannot express.
  testPosix('classifies a killed fetch as unreachable with a timeout detail', async () => {
    await useFakeGit();
    useWikiDataDir();
    process.env.FAKE_GIT_FETCH_KILL = '1';

    const result = await ensureWikiMirror('slow.test', 'o/n', 'https://slow.test/o/n.wiki.git');

    expect(result).toEqual({ ok: false, reason: 'unreachable', detail: 'The wiki fetch timed out' });
  });

  test('reports an empty wiki when the fetched ref holds no revision', async () => {
    await useFakeGit();
    useWikiDataDir();
    process.env.FAKE_GIT_LOG_FAIL = '1';

    const result = await ensureWikiMirror('empty.test', 'o/n', 'https://empty.test/o/n.wiki.git');

    expect(result).toEqual({ ok: false, reason: 'no-wiki', detail: 'The wiki repository holds no pages' });
  });
});
