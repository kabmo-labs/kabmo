/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The scoped-root allow-list and the two argv wrappers around it.
 *
 * `resolveWithinRoot` / `isWithinRoot` are the only thing standing between a
 * client-supplied path and the whole filesystem, so the cases that matter are
 * the refusals: a `..` escape and an absolute path outside the root. A sibling
 * directory that merely shares the root's name prefix (`/a/bc` vs `/a/b`) is
 * the classic off-by-one-separator bug, so it is pinned separately.
 *
 * `resolveRoot` / `resolveReferencedPath` add the two allow-listed sources
 * beside the app root: a subpath of it (no DB) and an exact registered
 * workspace `project_path` (DB). The DB cases run against a TEMP database so
 * the developer's real one is never read or written.
 *
 * `revealInFileManager` is pinned through its pre-spawn verdicts; the argv it
 * would spawn is asserted through the no-opener error (spawning a real file
 * manager is a side effect a test must not have). `runShell` is pinned on the
 * result shape callers branch on: exit code, both streams, and the timeout
 * kill.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { getDb } from '@/server/db.server';
import { getDefaultFsRoot, isWithinRoot, resolveReferencedPath, resolveRoot, resolveWithinRoot } from '@/server/lib/fs/root';
import { scopeToRepo } from '@/server/lib/fs/repo-scope';
import { revealInFileManager } from '@/server/lib/fs/reveal';
import { runShell, shellOk } from '@/server/lib/fs/shell';
import { removeDir } from '@/test-support/remove-dir';
import { testPosix } from '@/test-support/platform';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ompchamber-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

describe('isWithinRoot / resolveWithinRoot', () => {
  const root = resolve(sep, 'srv', 'workspace');

  test('the root itself and a nested path are inside', () => {
    expect(isWithinRoot(root, root)).toBe(true);
    expect(isWithinRoot(root, join(root, 'src', 'main.ts'))).toBe(true);
    expect(resolveWithinRoot(root, 'src/main.ts')).toBe(join(root, 'src', 'main.ts'));
    expect(resolveWithinRoot(root, '.')).toBe(root);
  });

  test('a `..` escape is refused', () => {
    expect(resolveWithinRoot(root, '../..')).toBeNull();
    expect(resolveWithinRoot(root, '../../etc/passwd')).toBeNull();
    expect(resolveWithinRoot(root, 'nested/../../outside')).toBeNull();
    // The escape target itself is not "inside" either.
    expect(isWithinRoot(root, resolve(root, '..'))).toBe(false);
  });

  test('an absolute path outside the root is refused', () => {
    expect(resolveWithinRoot(root, '/etc/passwd')).toBeNull();
    expect(isWithinRoot(root, '/etc/passwd')).toBe(false);
  });

  test('a sibling sharing the name prefix is NOT inside', () => {
    expect(isWithinRoot(root, `${root}-other`)).toBe(false);
    expect(isWithinRoot(root, `${root}other/file`)).toBe(false);
  });
});

describe('resolveRoot / resolveReferencedPath / getDefaultFsRoot', () => {
  test('a missing or blank root falls back', async () => {
    const fallback = '/fallback/root';
    expect(await resolveRoot(null, fallback)).toBe(fallback);
    expect(await resolveRoot(undefined, fallback)).toBe(fallback);
    expect(await resolveRoot('   ', fallback)).toBe(fallback);
    expect(await resolveRoot('', fallback)).toBe(fallback);
  });

  test('a path under the app root is allowed; a missing one is not', async () => {
    const inside = join(process.cwd(), 'src');
    expect(await resolveRoot(inside, '/fallback')).toBe(inside);
    expect(await resolveRoot(join(process.cwd(), 'no-such-dir-xyz'), '/fallback')).toBe('/fallback');
  });

  test('resolveReferencedPath rejects blank and missing references', async () => {
    expect(await resolveReferencedPath('   ')).toBeNull();
    expect(await resolveReferencedPath(join(process.cwd(), 'no-such-file-xyz'))).toBeNull();
  });

  test('getDefaultFsRoot is the app root, or examples/ in mock mode', async () => {
    expect(await getDefaultFsRoot(false)).toBe(process.cwd());
    const examples = join(process.cwd(), 'examples');
    expect(await getDefaultFsRoot(true)).toBe(existsSync(examples) ? examples : process.cwd());
  });

  // ---- DB-backed allow-list (TEMP database only) ----
  const dbDir = tempDir('fs-path-db');
  const dbPath = join(dbDir, 'test.sqlite');
  const registeredDir = join(dbDir, 'registered-project');
  const registeredFile = join(registeredDir, 'notes.txt');
  let savedSlot: typeof globalThis.__ompChamberDb;
  let savedEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    mkdirSync(registeredDir, { recursive: true });
    writeFileSync(registeredFile, 'x');
    savedSlot = globalThis.__ompChamberDb;
    savedEnv = {
      MOCK: Bun.env.MOCK,
      SYNC_WORKSPACE: Bun.env.SYNC_WORKSPACE,
      OMPCHAMBER_DB_PATH: Bun.env.OMPCHAMBER_DB_PATH,
      DB_PATH: Bun.env.DB_PATH,
    };
    Bun.env.MOCK = 'false';
    Bun.env.SYNC_WORKSPACE = 'false';
    Bun.env.OMPCHAMBER_DB_PATH = dbPath;
    delete Bun.env.DB_PATH;
    globalThis.__ompChamberDb = { promise: null, resolved: null };
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', ['proj', registeredDir]);
  });

  afterAll(() => {
    // Close the connection this block opened BEFORE restoring the slot and
    // deleting the tree. Restoring first loses the only reference to it, and on
    // Windows the still-open handle makes the delete fail with EBUSY — which a
    // throw from `afterAll` reports as a failure of this block.
    globalThis.__ompChamberDb?.resolved?.raw.close();
    globalThis.__ompChamberDb = savedSlot;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    }
    removeDir(dbDir);
  });

  test('an exact registered project_path is honored', async () => {
    expect(await resolveRoot(registeredDir, '/fallback')).toBe(registeredDir);
  });

  test('a subdirectory of a registered project is NOT an exact root match', async () => {
    expect(await resolveRoot(registeredDir + sep + 'sub', '/fallback')).toBe('/fallback');
  });

  test('resolveReferencedPath accepts a file nested in a registered project', async () => {
    expect(await resolveReferencedPath(registeredFile)).toBe(registeredFile);
  });

  test('an unregistered absolute path is still refused', async () => {
    const stray = join(dbDir, 'stray.txt');
    writeFileSync(stray, 'x');
    expect(await resolveReferencedPath(stray)).toBeNull();
  });
});

describe('scopeToRepo', () => {
  test('a null or `.` repo means the base directory', async () => {
    const base = tempDir('repo-scope');
    expect(await scopeToRepo(base, null)).toBe(base);
    expect(await scopeToRepo(base, '.')).toBe(base);
  });

  test('a nested directory is resolved and returned', async () => {
    const base = tempDir('repo-scope');
    const sub = join(base, 'packages', 'app');
    mkdirSync(sub, { recursive: true });
    expect(await scopeToRepo(base, 'packages/app')).toBe(sub);
  });

  test('escapes, missing paths and files are all rejected', async () => {
    const base = tempDir('repo-scope');
    writeFileSync(join(base, 'file.txt'), 'x');
    await expect(scopeToRepo(base, '../..')).rejects.toThrow('Invalid repo path');
    await expect(scopeToRepo(base, '/etc')).rejects.toThrow('Invalid repo path');
    await expect(scopeToRepo(base, 'missing')).rejects.toThrow('Invalid repo path');
    await expect(scopeToRepo(base, 'file.txt')).rejects.toThrow('Invalid repo path');
  });
});

describe('revealInFileManager verdicts', () => {
  test('a missing directory is named exactly', async () => {
    const missing = join(tmpdir(), 'ompchamber-no-such-dir-xyz');
    const result = await revealInFileManager(missing);
    expect(result).toEqual({ ok: false, error: `Directory does not exist: ${resolve(missing)}` });
  });

  test('a file is not a directory', async () => {
    const dir = tempDir('reveal');
    const file = join(dir, 'file.txt');
    writeFileSync(file, 'x');
    expect(await revealInFileManager(file)).toEqual({ ok: false, error: `Not a directory: ${file}` });
  });

  // The successful path spawns the real opener (`open` on darwin), which would
  // pop a Finder window as a test side effect, and `OPENERS` is module-private,
  // so the argv cannot be read without that spawn. The verdicts above are the
  // deterministic half of the contract.
});

// `runShell` runs `sh -c`, and on Windows that `sh` is Git-for-Windows' — which
// reports POSIX-style paths from `pwd` and needs a POSIX process group for the
// timeout kill. The portable cases stay; the two that assert either of those
// behaviours are POSIX-only.
describe('runShell', () => {
  test('exit 0, stdout and stderr are reported without throwing', async () => {
    const ok = await runShell('printf out; printf err 1>&2');
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toBe('out');
    expect(ok.stderr).toBe('err');
    expect(ok.error).toBeUndefined();
    expect(shellOk(ok)).toBe(true);
  });

  test('a non-zero exit is a value, not an exception', async () => {
    const bad = await runShell('exit 3');
    expect(bad.exitCode).toBe(3);
    expect(shellOk(bad)).toBe(false);
    expect(bad.error).toBeUndefined();
  });

  testPosix('cwd and env are applied to the child', async () => {
    const dir = tempDir('shell');
    const pwd = await runShell('pwd', { cwd: dir });
    expect(pwd.stdout.trim()).toBe(realpathSync(dir));
    const env = await runShell('printf "$OMPCHAMBER_TEST_FOO"', { env: { OMPCHAMBER_TEST_FOO: 'bar' } });
    expect(env.stdout).toBe('bar');
  });

  testPosix('a timeout kills the child and is surfaced as a signal', async () => {
    // `sh -c 'sleep 5'` forks on Linux (dash), so the shell's grandchild is what
    // holds stdout open: the timeout must signal the whole process GROUP, or
    // this read blocks until `sleep` finishes on its own and the case times out
    // instead of observing the signal.
    const killed = await runShell('sleep 5', { timeout: 100 });
    expect(killed.killed).toBe(true);
    expect(killed.signalCode).toBe('SIGTERM');
    expect(shellOk(killed)).toBe(false);
  });

  // The WINDOWS branch. It used to be a no-op there: `groupKill` was false, so
  // the timeout called `proc.kill` on the shell and left a forked child
  // running — and with `detached` also false there was no group to reach even
  // if the code had tried.
  //
  // The OUTCOME cannot be asserted from a POSIX host: the Windows branch spawns
  // `taskkill`, which does not exist here, and `detached` is off by design so
  // there is no group either — a measured probe took the full 30 s, which is
  // the absence of `taskkill` talking, not the code. What IS assertable is the
  // ROUTING, and that is the whole change: the timeout must reach the tree-kill
  // seam rather than the child handle. The seam's own Windows behaviour
  // (argv, `/f`, the fallback) is pinned in `kill-tree.test.ts`.
  testPosix('a timeout routes through the tree kill, not the child handle', async () => {
    const calls: { pid: number | undefined; force: boolean; signal: NodeJS.Signals }[] = [];

    const run = runShell('sleep 30', {
      timeout: 100,
      platform: 'win32',
      killTree: (pid, force, signal) => {
        calls.push({ pid, force, signal });
        // Do what `taskkill /t` does on Windows: terminate the WHOLE tree.
        // Signalling the shell alone is not enough here either — dash forks a
        // `sleep`, so the grandchild keeps the pipe open and the reads below
        // never resolve (measured: the case hangs to its 5 s timeout on
        // Debian, while it passes on macOS where `sh` execs a lone command).
        if (!pid) return;
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
      },
      // The shell must lead a group for the fake to reach its grandchild; on a
      // real Windows host `taskkill /t` walks the OS's recorded tree instead.
      detachForTest: true,
    });

    const result = await run;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ force: false, signal: 'SIGTERM' });
    expect(typeof calls[0]?.pid).toBe('number');
    expect(shellOk(result)).toBe(false);
  });
});
