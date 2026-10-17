/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** POSIX-only (`describePosix`): the suite spawns a stub binary written as a shebang script, which Windows cannot start. */

/**
 * The wiki read path is a git spawn plus a cache, and both fail silently when
 * they are wrong: a wiki path with a space that reaches a shell as a string is
 * mangled, a credential prompt with no terminal to answer it hangs the read to
 * its timeout, and a mirror keyed by the remote URL rather than by host+slug
 * would fetch the same wiki twice under its https and ssh spellings. These
 * tests pin the argv/env shape of `gitRun`, the four ways a fetch is classified,
 * the host→provider decision, and the reads that come back out of the mirror.
 *
 * No network: `git` is replaced by a script on PATH for the spawn-shape tests,
 * and the mirror-read tests use a local bare repository built in a temp dir.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { describePosix } from '@/test-support/platform';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { firstLine, gitRun } from '@/server/lib/wiki/git';
import { detectWikiProvider } from '@/server/lib/wiki/provider.server';
import { removeDir } from '@/test-support/remove-dir';
import {
  ensureWikiMirror,
  listWikiPaths,
  readWikiAsset,
  readWikiPage,
} from '@/server/lib/wiki/mirror.server';

const dirs: string[] = [];
const realPath = process.env.PATH;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A `git` that records its argv and answers init/fetch/log deterministically. */
const FAKE_GIT = `#!/bin/sh
if [ -n "$FAKE_GIT_LOG" ]; then
  { printf 'CALL'; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> "$FAKE_GIT_LOG"
fi
if [ -n "$FAKE_GIT_SIGNAL" ]; then kill -s "$FAKE_GIT_SIGNAL" $$; fi
case "$1" in
  init) mkdir -p "$4"; : > "$4/HEAD"; exit 0 ;;
esac
if [ "$3" = "fetch" ]; then
  if [ -n "$FAKE_GIT_FETCH_KILL" ]; then kill -TERM $$; fi
  if [ -n "$FAKE_GIT_FETCH_FAIL" ]; then printf '%s\\n' "$FAKE_GIT_FETCH_FAIL" >&2; exit 128; fi
  exit 0
fi
if [ "$3" = "log" ]; then
  if [ -n "$FAKE_GIT_LOG_FAIL" ]; then exit 1; fi
  printf '%s\\n%s\\n' "\${FAKE_GIT_REVISION:-abc123}" "\${FAKE_GIT_UPDATED:-2026-01-02T03:04:05Z}"
  exit 0
fi
for a in "$@"; do printf '%s\\n' "$a"; done
printf 'ENV=%s\\n' "$GIT_TERMINAL_PROMPT"
exit 0
`;

let gitLog = '';

/** Put the recording script first on PATH; every spawn below reaches it. */
function useFakeGit(): void {
  const bin = join(tempDir('omp-fake-git-'), 'bin');
  mkdirSync(bin, { recursive: true });
  const script = join(bin, 'git');
  writeFileSync(script, FAKE_GIT);
  chmodSync(script, 0o755);
  gitLog = join(tempDir('omp-git-log-'), 'calls.log');
  process.env.PATH = `${bin}:${realPath}`;
  process.env.FAKE_GIT_LOG = gitLog;
}

/** Every recorded argv, in call order. */
function gitCalls(): string[][] {
  return readFileSync(gitLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t').slice(1));
}

/** Point the mirror cache at a throwaway data directory. */
function useWikiDataDir(): void {
  process.env.OMPCHAMBER_DATA_DIR = tempDir('omp-wiki-data-');
}

/** Real-git helper for the local fixture repository. */
function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${proc.stderr.toString()}`);
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
let bareRepo = '';

afterEach(() => {
  process.env.PATH = realPath;
  globalThis.__ompChamberWikiCache = undefined;
  globalThis.__ompChamberWikiProviders = undefined;
  for (const key of [
    'FAKE_GIT_LOG',
    'FAKE_GIT_SIGNAL',
    'FAKE_GIT_FETCH_KILL',
    'FAKE_GIT_FETCH_FAIL',
    'FAKE_GIT_LOG_FAIL',
    'FAKE_GIT_REVISION',
    'FAKE_GIT_UPDATED',
  ]) {
    delete process.env[key];
  }
});

afterAll(() => {
  delete process.env.OMPCHAMBER_DATA_DIR;
  for (const dir of dirs.splice(0)) removeDir(dir);
});

describePosix('gitRun', () => {
  test('passes every argument as argv, so no shell can rewrite a path', async () => {
    useFakeGit();

    const result = await gitRun(['log', 'Setting up notes.md', 'a b"c$d'], { timeoutMs: 5_000 });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n').filter(Boolean)).toEqual(['log', 'Setting up notes.md', 'a b"c$d', 'ENV=0']);
  });

  test('sets GIT_TERMINAL_PROMPT=0 so a private wiki cannot block on a prompt', async () => {
    useFakeGit();

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

  test('reports a signalled process as failed', async () => {
    useFakeGit();
    process.env.FAKE_GIT_SIGNAL = 'TERM';

    const result = await gitRun(['log'], { timeoutMs: 5_000 });

    expect(result.failed).toBe(true);
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
// reaches the `#!/bin/sh` stub the rest of this file needs.
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
    globalThis.__ompChamberWikiProviders = {
      hosts: new Map([['probe.example.test', { provider: 'gitlab', at: Date.now() }]]),
    };

    expect(await detectWikiProvider('probe.example.test')).toBe('gitlab');
  });
});

describePosix('ensureWikiMirror', () => {
  test('fetches into a bare mirror keyed by host and slug', async () => {
    useFakeGit();
    useWikiDataDir();

    const result = await ensureWikiMirror('github.com', 'o/n', 'https://github.com/o/n.wiki.git');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mirror).toEqual({
      repoDir: join(process.env.OMPCHAMBER_DATA_DIR as string, 'wiki', 'github.com__o__n'),
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
    useFakeGit();
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
    useFakeGit();
    useWikiDataDir();
    process.env.FAKE_GIT_FETCH_FAIL =
      "remote: Repository not found.\nfatal: repository 'https://github.com/o/n.wiki.git/' not found";

    const result = await ensureWikiMirror('missing.test', 'o/n', 'https://missing.test/o/n.wiki.git');

    expect(result).toEqual({ ok: false, reason: 'no-wiki', detail: 'remote: Repository not found.' });
  });

  test('classifies a transport failure as unreachable', async () => {
    useFakeGit();
    useWikiDataDir();
    process.env.FAKE_GIT_FETCH_FAIL = "fatal: unable to access 'https://x/': Could not resolve host: x";

    const result = await ensureWikiMirror('other.test', 'o/n', 'https://other.test/o/n.wiki.git');

    expect(result).toEqual({
      ok: false,
      reason: 'unreachable',
      detail: "fatal: unable to access 'https://x/': Could not resolve host: x",
    });
  });

  test('classifies a killed fetch as unreachable with a timeout detail', async () => {
    useFakeGit();
    useWikiDataDir();
    process.env.FAKE_GIT_FETCH_KILL = '1';

    const result = await ensureWikiMirror('slow.test', 'o/n', 'https://slow.test/o/n.wiki.git');

    expect(result).toEqual({ ok: false, reason: 'unreachable', detail: 'The wiki fetch timed out' });
  });

  test('reports an empty wiki when the fetched ref holds no revision', async () => {
    useFakeGit();
    useWikiDataDir();
    process.env.FAKE_GIT_LOG_FAIL = '1';

    const result = await ensureWikiMirror('empty.test', 'o/n', 'https://empty.test/o/n.wiki.git');

    expect(result).toEqual({ ok: false, reason: 'no-wiki', detail: 'The wiki repository holds no pages' });
  });
});

describePosix('mirror reads', () => {
  test('lists every path in the tree, keeping a space in the name', async () => {
    await buildFixture();

    expect((await listWikiPaths(bareRepo)).sort()).toEqual(['Home.md', 'Setting up notes.md', 'images/schema.png']);
  });

  test('reads a page at the ref and reports a missing one', async () => {
    await buildFixture();

    expect(await readWikiPage(bareRepo, 'Home.md')).toEqual({ ok: true, text: 'Home\n', truncated: false });
    expect(await readWikiPage(bareRepo, 'Nope.md')).toEqual({ ok: false, error: 'Page not found: Nope.md' });
  });

  test('reads an asset as bytes and refuses a missing one', async () => {
    await buildFixture();

    expect(await readWikiAsset(bareRepo, 'images/schema.png')).toEqual(PNG_BYTES);
    expect(await readWikiAsset(bareRepo, 'images/nope.png')).toBe(null);
  });
});

async function buildFixture(): Promise<void> {
  if (bareRepo) return;
  const work = join(tempDir('omp-wiki-work-'), 'repo');
  mkdirSync(join(work, 'images'), { recursive: true });
  writeFileSync(join(work, 'Home.md'), 'Home\n');
  writeFileSync(join(work, 'Setting up notes.md'), 'notes\n');
  writeFileSync(join(work, 'images', 'schema.png'), PNG_BYTES);
  git(work, ['init', '-q']);
  git(work, ['add', '-A']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  bareRepo = join(tempDir('omp-wiki-bare-'), 'bare.git');
  const clone = Bun.spawnSync(['git', 'clone', '-q', '--bare', work, bareRepo], { stdout: 'pipe', stderr: 'pipe' });
  if (clone.exitCode !== 0) throw new Error(clone.stderr.toString());
  git(bareRepo, ['update-ref', 'refs/wiki/latest', 'HEAD']);
}
