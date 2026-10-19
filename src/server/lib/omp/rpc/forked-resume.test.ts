/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A resumed session that omp FORKS must be adopted, not re-spawned.
 *
 * omp 18.10.0 forks a session marked moved away (`omp session moved`, or a
 * `departed` transfer marker) instead of continuing it, and answers a fresh
 * `sessionId` and `sessionFile` — verified against a real 18.10.0 child, which
 * resumed a departed file into another directory under a new id.
 *
 * The registry is keyed by the id the CALLER holds (the URL's session id), so
 * without an alias for the reported id the very next send re-resolved the
 * ORIGINAL file and spawned again. Measured before the fix: two sends on one
 * session file produced TWO children with two different ids — a chain of forks,
 * a sidebar row each, and nothing on screen explaining the duplication.
 *
 * This drives the real spawn path (`startRpcSession` → `RpcProcess` → the
 * scripted child), not a stub of it: the child speaks omp's own NDJSON wire and
 * reports a forked identity, which is the only way the difference between the
 * requested and the reported id can arise.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describePosix } from '@/test-support/platform';

import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { stopDiscoveryRootsWatch } from '@/server/lib/omp/config/roots-watch.server';
import { getRpcSession, startRpcSession } from '@/server/lib/omp/rpc/session-registry';

/** One line per spawned child, written by the scripted omp. */
interface ForkRecord {
  requestedId: string;
  sessionId: string;
  sessionFile: string;
  pid: number;
}

let root: string;
let saved: Record<string, string | undefined>;

const ENV_KEYS = [
  'KABMO_OMP_BIN',
  'PI_CODING_AGENT_DIR',
  'KABMO_DB_PATH',
  'SYNC_WORKSPACE',
  'FAKE_OMP_FORK_ON_RESUME',
  'FAKE_OMP_FORK_LOG',
] as const;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'omp-fork-test-'));
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, Bun.env[key]]));
  Bun.env.KABMO_OMP_BIN = join(import.meta.dir, '../../../../test-support/fake-omp-fork.ts');
  Bun.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  Bun.env.KABMO_DB_PATH = join(root, 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  Bun.env.FAKE_OMP_FORK_ON_RESUME = '1';
  Bun.env.FAKE_OMP_FORK_LOG = join(root, 'forks.jsonl');
  delete globalThis.__ompSessions;
  delete globalThis.__ompStartLocks;
});

afterEach(() => {
  stopDiscoveryRootsWatch();
  delete globalThis.__ompSessions;
  delete globalThis.__ompStartLocks;
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

/** The children the scripted omp actually started, in spawn order. */
function spawnedChildren(): ForkRecord[] {
  const path = Bun.env.FAKE_OMP_FORK_LOG;
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ForkRecord);
}

// The scripted omp is spawned from a `#!/usr/bin/env bun` `.ts` file; Windows
// can start a real executable, not a shebang file, so `uv_spawn` answers EFTYPE.
describePosix('a forked resume is adopted under the requested id', () => {
  test('two sends on one session file reuse the forked child instead of spawning again', async () => {
    invalidateOmpCliCache();
    const cwd = join(root, 'ws');
    const sessionsDir = join(root, 'agent', 'sessions', 'ws');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    const sessionFile = join(sessionsDir, 's.jsonl');
    writeFileSync(sessionFile, '');

    const requested = 'requested-session-id';
    const first = await startRpcSession(requested, sessionFile, cwd);
    const second = await startRpcSession(requested, sessionFile, cwd);

    // The child answered a DIFFERENT id than the one resumed — that is the
    // condition under test, and without it the test proves nothing.
    expect(first.realSessionId).not.toBe(requested);
    expect(spawnedChildren().length).toBe(1);
    expect(second.session).toBe(first.session);
    expect(second.realSessionId).toBe(first.realSessionId);
    // The id the CLIENT holds must resolve, or the next POST spawns again.
    expect(getRpcSession(requested)).toBe(first.session);

    first.session.destroy();
  }, 30_000);
});
