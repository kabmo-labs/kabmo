/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `port-guard.ts` decides whether this process may take a port, and its whole
 * value is in the failure path: a starter that loses the race must fail with a
 * message that names the real situation instead of a bare `EADDRINUSE`. These
 * tests therefore drive both mechanisms the module can pick — the `flock(2)`
 * lease and the PID-file fallback — and both claim outcomes: the bind succeeds,
 * or the error text carries the occupant / the underlying bind error.
 *
 * The fallback is forced where its recovery logic is the subject (a dead
 * holder, a recycled PID): `flock` ignores the lock file's contents, so those
 * branches are otherwise unreachable on this host. Everything runs against
 * temp data directories and OS-assigned ports; the only subprocesses are
 * throwaway `bun -e` holders, never an `omp` server.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testPosix } from '@/test-support/platform';

import { flockAvailable } from '@/server/lib/lifecycle/flock';
import type { FlockHandle } from '@/server/lib/lifecycle/flock';
import { getProcessState } from '@/server/lib/lifecycle/identity';
import { getLockPath } from '@/server/lib/lifecycle/paths';
import { acquirePortLock, claimPort, PortInUseError } from '@/server/lib/lifecycle/port-guard';
import type { PortLock } from '@/server/lib/lifecycle/port-guard';
import { waitForPortFree } from '@/server/lib/lifecycle/probe';

let tempDir: string;
let originalDataDir: string | undefined;
/** The runner's own fetch, captured before any test runs. */
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const realFetch = Bun.fetch;
const leases: (PortLock | FlockHandle)[] = [];
const children: Bun.Subprocess[] = [];
const servers: Server<undefined>[] = [];

/** The flock singleton is anchored on `globalThis`; leaked state spans suites. */
function flockHost(): { __ompChamberFlock?: unknown } {
  return globalThis as unknown as { __ompChamberFlock?: unknown };
}

/**
 * Force the PID-file fallback for one test.
 *
 * `flock` keys on the inode and never reads the file, so the stale-holder and
 * recycled-PID recovery below — the only reason the fallback exists — cannot be
 * observed while the real mechanism is active.
 */
function usePidFileFallback(): void {
  flockHost().__ompChamberFlock = { held: new Map(), available: false, lib: null };
}

function track<T extends PortLock | FlockHandle>(lease: T | null): T | null {
  if (lease) leases.push(lease);
  return lease;
}

/**
 * A real process whose argv says `ompchamber`, i.e. `matched` to identity.ts.
 *
 * The child announces itself before it parks, and that line is what says the OS
 * has finished `exec`: a freshly spawned process's command line is unreadable
 * for the instant between fork and exec (`/proc/<pid>/cmdline` reads empty
 * there, so Linux's probe falls back to `comm` and identity answers
 * `mismatched` for a process that IS ours). Production reads a PID out of a
 * lock file written by a process started long before, so it never sees that
 * window — no fixed delay to guess at here.
 */
async function spawnChamberHolder(): Promise<Bun.Subprocess> {
  const child = Bun.spawn({
    cmd: ['bun', '-e', 'console.log("ready"); await new Promise(() => {})', 'ompchamber-holder'],
    stdout: 'pipe',
    stderr: 'ignore',
  });
  children.push(child);
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  await reader.read();
  reader.releaseLock();
  expect(getProcessState(child.pid)).toBe('matched');
  return child;
}

/** A PID that has exited and been reaped, so it reads as `dead`. */
async function deadPid(): Promise<number> {
  const child = Bun.spawn({ cmd: ['bun', '-e', 'process.exit(0)'], stdout: 'ignore', stderr: 'ignore' });
  const pid = child.pid;
  await child.exited;
  expect(getProcessState(pid)).toBe('dead');
  return pid;
}

/** An OS-assigned port, released and confirmed free before use. */
async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('unused') });
  const port = server.port;
  if (port === undefined) throw new Error('the OS did not assign an ephemeral port');
  server.stop(true);
  if (!(await waitForPortFree(port, '127.0.0.1', 2_000, 25))) throw new Error(`ephemeral port ${port} never became free`);
  return port;
}

/** A live listener on an OS-assigned port, held for the whole test. */
/** A live listener on an OS-assigned port; the guard reads the assigned
 *  number, never `server.port` (`number | undefined` in Bun's types). */
function occupy(fetch: (request: Request) => Response): number {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch });
  const port = server.port;
  if (port === undefined) throw new Error('the OS did not assign an ephemeral port');
  servers.push(server);
  return port;
}

beforeEach(() => {
  originalDataDir = Bun.env.OMPCHAMBER_DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompchamber-test-port-guard-'));
  Bun.env.OMPCHAMBER_DATA_DIR = tempDir;
  // `claimPort` asks the occupant whether it is an Kabmo server, over the
  // global fetch. A stub another file left installed would answer for it.
  globalThis.fetch = realFetch;
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    try {
      child.kill('SIGKILL');
      await child.exited;
    } catch {
      // Already gone.
    }
  }
  for (const server of servers.splice(0)) server.stop(true);
  for (const lease of leases.splice(0)) lease.release();
  delete flockHost().__ompChamberFlock;
  if (originalDataDir === undefined) delete Bun.env.OMPCHAMBER_DATA_DIR;
  else Bun.env.OMPCHAMBER_DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('acquirePortLock', () => {
  test('grants a free port lock and re-grants it after release', async () => {
    const first = track(await acquirePortLock(4211, 0));
    expect(first).not.toBeNull();
    first!.release();

    // A released lock must not keep the next starter out.
    expect(track(await acquirePortLock(4211, 0))).not.toBeNull();
  });

  // The `flock(2)` half of this comparison does not exist on Windows: there the
  // PID-file fallback is the only mechanism, so "follows the active mechanism"
  // has no second mechanism to contrast against (and `flock` refcounts).
  testPosix('a second acquire while held follows the active mechanism', async () => {
    const first = track(await acquirePortLock(4212, 0));
    expect(first).not.toBeNull();
    const second = await acquirePortLock(4212, 0);

    if (flockAvailable()) {
      // `flock(2)` is per open-file-description, so the module refcounts instead
      // of deadlocking a second acquire inside one process.
      expect(second).not.toBeNull();
    } else {
      // The PID-file lock is exclusive by `wx` create: a live holder wins.
      expect(second).toBeNull();
    }
    second?.release();
  });

  test('reclaims a lock whose holder is dead', async () => {
    usePidFileFallback();
    const lockPath = getLockPath(4213);
    fs.writeFileSync(lockPath, String(await deadPid()));

    const reclaimed = track(await acquirePortLock(4213, 0));

    expect(reclaimed).not.toBeNull();
    // The reclaimed lock is ours now, so releasing it removes the file.
    reclaimed!.release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  // A "stranger" vs "ours" verdict reads the process command line
  // (`getProcessState`); on Windows `commandLine` returns null, so every live
  // pid reads `unknown` and neither the reclaim nor the refusal below is
  // observable there.
  testPosix('reclaims a lock whose PID was recycled to a stranger', async () => {
    usePidFileFallback();
    // A live PID that is not Kabmo means the recorded instance is gone;
    // refusing here would block startup on a free port forever.
    const stranger = Bun.spawn({ cmd: ['bun', '-e', 'await new Promise(() => {})'], stdout: 'ignore', stderr: 'ignore' });
    children.push(stranger);
    expect(getProcessState(stranger.pid)).toBe('mismatched');
    fs.writeFileSync(getLockPath(4214), String(stranger.pid));

    expect(track(await acquirePortLock(4214, 0))).not.toBeNull();
  });

  testPosix('refuses a lock held by a live Kabmo process', async () => {
    usePidFileFallback();
    const holder = await spawnChamberHolder();
    const lockPath = getLockPath(4215);
    fs.writeFileSync(lockPath, String(holder.pid));

    expect(await acquirePortLock(4215, 0)).toBeNull();
    // A refused acquire must not damage the holder's lock file.
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(holder.pid));
  });
});

describe('claimPort', () => {
  test('binds a free port through the injected listen', async () => {
    const port = await freePort();
    let binds = 0;

    await claimPort({ port, host: '127.0.0.1', listen: async () => { binds += 1; } });

    expect(binds).toBe(1);
  });

  test('re-binds when the occupant is this very process', async () => {
    // `bun run --hot` re-evaluates the entry inside the running process, so the
    // port is held by us and Bun swaps the handler on the next listen. Killing
    // the dev loop on every save is the failure this prevents.
    const port = occupy(() => Response.json({ service: 'ompchamber', pid: process.pid }));
    let binds = 0;

    await claimPort({ port, host: '127.0.0.1', listen: async () => { binds += 1; } });

    expect(binds).toBe(1);
  });

  testPosix('names an Kabmo occupant held by another process', async () => {
    const holder = await spawnChamberHolder();
    const port = occupy(() => Response.json({ service: 'ompchamber', pid: holder.pid, version: '9.9.9' }));
    let binds = 0;

    const error = await claimPort({ port, host: '127.0.0.1', listen: async () => { binds += 1; } })
      .then(() => null, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PortInUseError);
    const message = (error as Error).message;
    expect(message).toContain(`Port ${port} is already served by Kabmo`);
    expect(message).toContain(`pid ${holder.pid}`);
    expect(message).toContain('v9.9.9');
    expect(message).toContain('Nothing was stopped');
    // A starting instance never binds over an identified one.
    expect(binds).toBe(0);
  });

  test('names a foreign listener as not Kabmo, without a bind error', async () => {
    // Nothing answers `/api/health` and nothing identifies itself, so the probe
    // fails first and `listen` is never attempted.
    const port = occupy(() => new Response('not ompchamber'));
    let binds = 0;

    const error = await claimPort({ port, host: '127.0.0.1', listen: async () => { binds += 1; } })
      .then(() => null, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PortInUseError);
    const message = (error as Error).message;
    expect(message).toContain(`Port ${port} is in use by another process`);
    expect(message).toContain(`lsof -nP -iTCP:${port} -sTCP:LISTEN`);
    expect(message).not.toContain('Bind error');
    expect(binds).toBe(0);
  });

  test('carries the bind error when the port looked free', async () => {
    // The probe is only a short-circuit; when `listen` fails anyway, the real
    // reason must survive into the error rather than being replaced by a guess.
    const port = await freePort();

    const error = await claimPort({
      port,
      host: '127.0.0.1',
      listen: async () => { throw new Error('EADDRINUSE: address already in use'); },
    }).then(() => null, (thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(PortInUseError);
    expect((error as Error).message).toContain('Bind error: EADDRINUSE: address already in use');
  });
});
