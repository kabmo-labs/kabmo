/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The global session registry's identity bookkeeping and the prewarm claim.
 *
 * Two things here are load-bearing and invisible at the call site. The claim in
 * `startNewRpcSession` is a synchronous check-and-set: if it were not, two
 * sends racing the same prewarmed child would both adopt it and one would talk
 * to a process the other owns. And the registry's lookups answer the sidebar's
 * "needs input" and "running" badges, so a session reported under the wrong id
 * (or reported while dead) shows a spinner or a prompt on the wrong row.
 *
 * No omp child is ever spawned: the prewarmed entry is a fake handle, and only
 * paths that adopt or read one are exercised. The cold-spawn branches
 * (mode mismatch, dead entry, spawn failure) all end in a real spawn and are
 * therefore not covered here.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDir } from '@/test-support/remove-dir';

import {
  getAwaitingInputSessionIds,
  getLiveRunSessionIds,
  getRpcSession,
  listRpcSessions,
  startNewRpcSession,
} from '@/server/lib/omp/rpc/session-registry';
import { stopDiscoveryRootsWatch } from '@/server/lib/omp/config/roots-watch.server';
import type { AgentSessionWrapper } from '@/server/lib/omp/rpc/manager';
import { DEFAULT_APPROVAL_MODE } from '@/shared/lib/omp/config/access-mode';

interface FakeSession {
  session: AgentSessionWrapper;
  destroys: number;
  fireDestroy(): void;
}

function makeSession(options: {
  sessionId: string;
  cwd?: string;
  alive?: boolean;
  running?: boolean;
  dialogs?: number;
}): FakeSession {
  const alive = options.alive ?? true;
  let destroys = 0;
  let destroyCallback: (() => void) | null = null;
  const fake = {
    sessionId: options.sessionId,
    cwd: options.cwd ?? process.cwd(),
    isAlive: () => alive,
    isRunning: () => options.running ?? false,
    getPendingUiDialogs: () =>
      Array.from({ length: options.dialogs ?? 0 }, (_, index) => ({ type: 'extension_ui_request', id: `dialog-${index}` })),
    onDestroy: (callback: () => void) => {
      destroyCallback = callback;
    },
    destroyAndWait: async () => {
      destroys += 1;
    },
  };
  return {
    session: fake as unknown as AgentSessionWrapper,
    get destroys() {
      return destroys;
    },
    fireDestroy: () => destroyCallback?.(),
  } as FakeSession;
}

let root: string;
let savedDbPath: string | undefined;
let savedAgentDir: string | undefined;
let savedSyncWorkspace: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kabmo-test-'));
  savedDbPath = Bun.env.KABMO_DB_PATH;
  savedAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  savedSyncWorkspace = Bun.env.SYNC_WORKSPACE;
  // A throwaway database and agent dir keep the discovery-roots reconcile (which
  // every adopt path awaits) inside the temp tree instead of the user's config.
  Bun.env.KABMO_DB_PATH = join(root, 'db.sqlite');
  Bun.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete globalThis.__ompSessions;
  delete globalThis.__ompStartLocks;
  delete globalThis.__ompPrewarmed;
  delete globalThis.__kabmoDb;
});

afterEach(() => {
  stopDiscoveryRootsWatch();
  delete globalThis.__ompSessions;
  delete globalThis.__ompStartLocks;
  delete globalThis.__ompPrewarmed;
  // CLOSE the db handle before dropping it and deleting the tree: a bare
  // `delete` abandons the connection, and on Windows the still-open handle makes
  // the `rm` fail with EBUSY.
  globalThis.__kabmoDb?.resolved?.raw.close();
  delete globalThis.__kabmoDb;
  if (savedDbPath === undefined) delete Bun.env.KABMO_DB_PATH;
  else Bun.env.KABMO_DB_PATH = savedDbPath;
  if (savedAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = savedAgentDir;
  if (savedSyncWorkspace === undefined) delete Bun.env.SYNC_WORKSPACE;
  else Bun.env.SYNC_WORKSPACE = savedSyncWorkspace;
  removeDir(root);
});

function registry(): Map<string, AgentSessionWrapper> {
  globalThis.__ompSessions ??= new Map();
  return globalThis.__ompSessions;
}

function prewarmPool(): Map<string, never> {
  globalThis.__ompPrewarmed ??= new Map();
  return globalThis.__ompPrewarmed as unknown as Map<string, never>;
}

describe('registry lookups', () => {
  test('a live session is found by id, an unknown id is not', () => {
    const fake = makeSession({ sessionId: 'sess-1' });
    registry().set('sess-1', fake.session);
    expect(getRpcSession('sess-1')).toBe(fake.session);
    expect(getRpcSession('sess-2')).toBeUndefined();
  });

  test('a dead session is dropped from the live list but stays addressable', () => {
    const live = makeSession({ sessionId: 'live' });
    const dead = makeSession({ sessionId: 'dead', alive: false });
    registry().set('live', live.session);
    registry().set('dead', dead.session);
    expect(listRpcSessions()).toEqual([live.session]);
    expect(getRpcSession('dead')).toBe(dead.session);
  });
});

describe('getAwaitingInputSessionIds', () => {
  test('only an alive session with a pending dialog is reported', () => {
    registry().set('idle', makeSession({ sessionId: 'idle' }).session);
    registry().set('asking', makeSession({ sessionId: 'asking', dialogs: 1 }).session);
    registry().set('dead-asking', makeSession({ sessionId: 'dead-asking', alive: false, dialogs: 1 }).session);
    expect(getAwaitingInputSessionIds()).toEqual(['asking']);
  });

  test('a session whose own id is empty is reported under its registry key', () => {
    registry().set('map-key', makeSession({ sessionId: '', dialogs: 2 }).session);
    expect(getAwaitingInputSessionIds()).toEqual(['map-key']);
  });
});

describe('getLiveRunSessionIds', () => {
  test('reports running sessions only, and de-duplicates the identity fallback', () => {
    registry().set('running', makeSession({ sessionId: 'running', running: true }).session);
    registry().set('idle', makeSession({ sessionId: 'idle' }).session);
    registry().set('dead-running', makeSession({ sessionId: 'dead-running', alive: false, running: true }).session);
    registry().set('map-key', makeSession({ sessionId: '', running: true }).session);
    expect(getLiveRunSessionIds()).toEqual(new Set(['running', 'map-key']));
  });
});

describe('startNewRpcSession claims a prewarmed entry', () => {
  test('the claim is synchronous: the entry is marked and removed before readiness resolves', async () => {
    const fake = makeSession({ sessionId: 'sess-1' });
    let release: (wrapper: AgentSessionWrapper) => void = () => {};
    const ready = new Promise<AgentSessionWrapper>((resolve) => {
      release = resolve;
    });
    const entry = { cwd: root, approvalMode: DEFAULT_APPROVAL_MODE, modeEnv: undefined, ready, claimed: false };
    prewarmPool().set(root, entry as never);

    const started = startNewRpcSession(root);
    // Nothing has been adopted yet, but the entry is already spoken for: a
    // second caller (or the recycle pass) can no longer take it.
    expect(entry.claimed).toBe(true);
    expect(prewarmPool().has(root)).toBe(false);

    release(fake.session);
    const result = await started;
    expect(result.session).toBe(fake.session);
    expect(result.realSessionId).toBe('sess-1');
    expect(fake.destroys).toBe(0);
  });

  test('the adopted wrapper is registered under its real id and leaves on destroy', async () => {
    const fake = makeSession({ sessionId: 'sess-42' });
    prewarmPool().set(root, {
      cwd: root,
      approvalMode: DEFAULT_APPROVAL_MODE,
      modeEnv: undefined,
      ready: Promise.resolve(fake.session),
      claimed: false,
    } as never);

    await startNewRpcSession(root);
    expect(getRpcSession('sess-42')).toBe(fake.session);
    expect(listRpcSessions()).toEqual([fake.session]);

    fake.fireDestroy();
    expect(getRpcSession('sess-42')).toBeUndefined();
  });

  test('a prewarmed entry for another cwd is left untouched', async () => {
    const other = join(root, 'other-workspace');
    const fake = makeSession({ sessionId: 'sess-7' });
    const otherEntry = {
      cwd: other,
      approvalMode: DEFAULT_APPROVAL_MODE,
      modeEnv: undefined,
      ready: Promise.resolve(fake.session),
      claimed: false,
    };
    prewarmPool().set(other, otherEntry as never);
    prewarmPool().set(root, {
      cwd: root,
      approvalMode: DEFAULT_APPROVAL_MODE,
      modeEnv: undefined,
      ready: Promise.resolve(makeSession({ sessionId: 'sess-8' }).session),
      claimed: false,
    } as never);

    await startNewRpcSession(root);
    expect(otherEntry.claimed).toBe(false);
    expect(prewarmPool().get(other)).toBe(otherEntry as never);
  });
});
