/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The cross-process session ownership guard.
 *
 * The load-bearing properties:
 *   - the lease path matches omp's own naming rule exactly (a plain token used
 *     verbatim plus the `.lock` suffix, anything else hashed), since a mismatch
 *     would silently look for a file that never exists and the guard would never
 *     fire;
 *   - a lease held by another process is reported with the HOLDER's pid, and one
 *     held by nobody is free even though the file remains (the OS drops the
 *     lock, not the file);
 *   - a lease held by THIS process is not a conflict.
 *
 * The holder is a REAL `flock` taken through the same FFI helper the probe uses,
 * and its pid is found by the same descriptor walk the production path uses —
 * no subprocess anywhere.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { testPosix } from '@/test-support/platform';

import {
  resolveSessionOwnership,
  SessionOwnedElsewhereError,
  sessionLeasePath,
  sessionOwnersDir,
} from '@/server/lib/omp/session/ownership.server';
import { holdLeaseForTest, leaseHeldByAnother } from '@/server/lib/omp/session/lease-flock.server';
import { fileHolderPid } from '@/server/lib/omp/session/lease-holder.server';
import { getRpcSession, startRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { removeDir } from '@/test-support/remove-dir';

let root: string;
let savedXdg: string | undefined;
let savedDbPath: string | undefined;
let savedAgentDir: string | undefined;
const releases: Array<() => void> = [];
const children: number[] = [];

/** A lease file that exists but is held by nobody. */
function makeLeaseFile(sessionId: string): string {
  const lease = sessionLeasePath(sessionId);
  mkdirSync(dirname(lease), { recursive: true });
  writeFileSync(lease, '');
  return lease;
}

/** A lease file held by this test process (a real holder, via FFI). */
function holdLease(sessionId: string): string {
  const lease = makeLeaseFile(sessionId);
  const handle = holdLeaseForTest(lease);
  releases.push(handle.release);
  return lease;
}

/**
 * Hold the lease from a SEPARATE, REPARENTED process — the shape a real second
 * chamber instance has.
 *
 * A child spawned directly by this process is, by the guard's own rule, "our
 * own child" (its parent pid IS this pid), so it can never exercise the foreign
 * path. The holder is therefore started under `setsid`, which detaches it from
 * this process's session and reparents it to init — exactly how a second
 * server's omp child looks from here.
 */
async function holdLeaseInChild(sessionId: string): Promise<number> {
  const lease = makeLeaseFile(sessionId);
  const script = `
    const { holdLeaseForTest } = await import(${JSON.stringify(`${import.meta.dir}/lease-flock.server.ts`)});
    holdLeaseForTest(process.argv[1]);
    await Promise.withResolvers().promise;
  `;
  // The child must resolve the SAME lease directory this test uses, and
  // `Bun.env` mutations in the parent are NOT inherited by a spawn — the
  // environment has to be passed explicitly, or the child locks a lease under
  // the real `~/.omp` while the test inspects the temp one.
  //
  // The `sh -c '… &'` wrapper exits immediately, reparenting `bun` to init.
  // macOS ships no `setsid`, and a directly-spawned child would be "our own
  // child" to the guard, so this is the portable way to get a foreign holder.
  // The background process must NOT inherit the wrapper's stdout pipe, or
  // reading `$!` would block until that process exits.
  const inner = `exec ${JSON.stringify(process.execPath)} -e ${shellQuote(script)} ${shellQuote(lease)}`;
  const child = Bun.spawn(['sh', '-c', `{ ${inner} >/dev/null 2>&1 & } ; echo $!`], {
    stdout: 'pipe',
    stderr: 'ignore',
    env: { ...Bun.env, XDG_STATE_HOME: root, PI_CODING_AGENT_DIR: join(root, 'agent') },
  });
  const pid = Number((await new Response(child.stdout).text()).trim());
  if (Number.isFinite(pid) && pid > 0) children.push(pid);
  return pid;
}

/** POSIX single-quote a string for `sh -c`. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Wait until a process other than this one actually holds the lease. */
async function waitForForeignHolder(leasePath: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (leaseHeldByAnother(leasePath) === true && fileHolderPid(leasePath) !== process.pid) return;
    await Bun.sleep(10);
  }
}

beforeEach(() => {
  root = join(tmpdir(), `ompchamber-owner-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  // XDG state root, with the omp app dir pre-created so `sessionOwnersDir`
  // takes the XDG branch instead of the user's real `~/.omp`.
  mkdirSync(join(root, 'omp', 'run', 'session-owners'), { recursive: true });
  savedXdg = Bun.env.XDG_STATE_HOME;
  savedDbPath = Bun.env.OMPCHAMBER_DB_PATH;
  savedAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  Bun.env.XDG_STATE_HOME = root;
  Bun.env.OMPCHAMBER_DB_PATH = join(root, 'db.sqlite');
  // Keep the workspace-sync seed (which reads omp discovery) inside the temp
  // tree: without this every run scans the user's real session directory.
  Bun.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  delete globalThis.__ompChamberDb;
  delete globalThis.__ompSessions;
  delete globalThis.__ompStartLocks;
});

afterEach(() => {
  for (const pid of children) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  children.length = 0;
  for (const release of releases) {
    try {
      release();
    } catch {
      // Already released.
    }
  }
  releases.length = 0;
  if (savedXdg === undefined) delete Bun.env.XDG_STATE_HOME;
  else Bun.env.XDG_STATE_HOME = savedXdg;
  if (savedDbPath === undefined) delete Bun.env.OMPCHAMBER_DB_PATH;
  else Bun.env.OMPCHAMBER_DB_PATH = savedDbPath;
  if (savedAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = savedAgentDir;
  delete globalThis.__ompChamberDb;
  delete globalThis.__ompSessions;
  delete globalThis.__ompStartLocks;
  removeDir(root);
});

describe('sessionLeasePath', () => {
  test('a plain token id is used verbatim, with the .lock suffix', () => {
    expect(sessionLeasePath('01a103dc-5823-7386-969f-51fa6be299cd')).toBe(
      join(sessionOwnersDir(), '01a103dc-5823-7386-969f-51fa6be299cd.lock'),
    );
  });

  test('an id that could name a path is hashed, never joined raw', () => {
    const lease = sessionLeasePath('../../etc/passwd');
    expect(lease.startsWith(sessionOwnersDir())).toBe(true);
    expect(lease).not.toContain('..');
    expect(lease).toMatch(/h-[0-9a-f]{16}\.lock$/);
  });
});

describe('leaseHeldByAnother', () => {
  // Every case that names a HOLDER reaches `flock(2)` (`holdLeaseForTest` throws
  // `flock unavailable on this host` on Windows), and a lease file that EXISTS
  // but is not held reads back `null` (cannot answer) rather than "free". Only
  // the missing-file case is portable: absence is free on every host.
  testPosix('a file held by this process reads as held', () => {
    const lease = holdLease('flock-held');
    expect(leaseHeldByAnother(lease)).toBe(true);
  });

  testPosix('an existing file with no holder reads as free', () => {
    expect(leaseHeldByAnother(makeLeaseFile('flock-free'))).toBe(false);
  });

  test('a missing file reads as free, never unknown', () => {
    expect(leaseHeldByAnother(join(root, 'nope.lock'))).toBe(false);
  });
});

describe('fileHolderPid', () => {
  // The descriptor walk runs over libproc/`/proc`; on Windows neither exists and
  // the holder cannot be named ("null" is also the no-holder answer, so only the
  // NULL case below is portable).
  testPosix('names the process holding the descriptor', () => {
    const lease = holdLease('holder-pid');
    expect(fileHolderPid(lease)).toBe(process.pid);
  });

  test('null when no process holds it', () => {
    expect(fileHolderPid(makeLeaseFile('holder-none'))).toBeNull();
  });
});

describe('resolveSessionOwnership', () => {
  test('a session with no lease file is free', async () => {
    expect(await resolveSessionOwnership('never-claimed')).toBeNull();
  });

  test('a held lease with no holder is free, not a conflict', async () => {
    // A file with no lock and no open descriptor: the OS dropped the lock when
    // its holder exited, so the session is free even though the file remains.
    makeLeaseFile('stale-session');
    expect(await resolveSessionOwnership('stale-session', 1)).toBeNull();
  });

  // Both of these hold a real lease (`holdLease` → `flock`, `holdLeaseInChild` →
  // a detached `sh -c` holder): `flock(2)` does not exist on Windows.
  testPosix('a lease held by THIS process is our own child, not a conflict', async () => {
    holdLease('own-child');
    expect(await resolveSessionOwnership('own-child', process.pid)).toBeNull();
  });

  testPosix('a lease held by another process is reported with the holder pid', async () => {
    const id = 'foreign-holder';
    const lease = sessionLeasePath(id);
    const childPid = await holdLeaseInChild(id);
    await waitForForeignHolder(lease);
    const ownership = await resolveSessionOwnership(id, process.pid);
    expect(ownership?.holderPid).toBe(childPid);
    expect(ownership?.source).toBe('lease');
  });
});

describe('startRpcSession refuses a foreign-owned session', () => {
  // Holds the lease from a detached `sh -c` child; no `sh`/`flock` on Windows.
  testPosix('throws before spawning when the lease is held elsewhere', async () => {
    const id = 'foreign-owned';
    const lease = sessionLeasePath(id);
    await holdLeaseInChild(id);
    await waitForForeignHolder(lease);
    // A non-empty session file is what makes the guard run; the throw must land
    // BEFORE any spawn, so no omp child is ever started for this id.
    const attempt = startRpcSession(id, join(root, 'session.jsonl'), root, root);
    await expect(attempt).rejects.toThrow(SessionOwnedElsewhereError);
    expect(getRpcSession(id)).toBeUndefined();
  });
});

describe('SessionOwnedElsewhereError', () => {
  test('names the owning instance when one is known', () => {
    const error = new SessionOwnedElsewhereError('sess-1', {
      holderPid: 4242,
      owner: { pid: 4242, port: 3001, host: '0.0.0.0', mode: 'dev', launchMode: 'daemon', startedAt: '', version: '1' },
      source: 'lease',
    });
    expect(error.message).toContain('port 3001');
    expect(error.sessionId).toBe('sess-1');
  });

  test('falls back to a plain refusal when the holder cannot be placed', () => {
    const error = new SessionOwnedElsewhereError('sess-1', { holderPid: null, owner: null, source: 'lease' });
    expect(error.message).not.toContain('port');
    expect(error.message).toContain('another process');
  });
});
