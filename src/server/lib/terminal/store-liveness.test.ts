/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The terminal registry's process-anchored state and the liveness decision.
 *
 * `store.ts` exists because a `bun run --hot` reload re-evaluates the module
 * while the PTY children keep running. Two failures follow from getting it
 * wrong, and both are silent: a fresh `sessions` Map orphans every live shell
 * (unreachable, uncounted, unreaped), and a fresh `creating` Map lets two
 * concurrent attaches for one id spawn two shells where only one record can
 * exist. The first is pinned by the legacy-global adoption cases; the second by
 * driving two concurrent `attachTerminal` calls for one new id — the real PTY
 * path, because that is where the race lives — and asserting that both landed
 * on a single record with both viewers on it. A rival session would leave one
 * viewer per record and strand the other shell.
 *
 * `liveness.server.ts` decides the cap's budget, so the cases pin which records
 * are candidates at all: an exited shell and a shell with no process are
 * corpses holding scrollback and must not consume a slot, while a running shell
 * with a live process must be asked about. The session records are fakes; the
 * probe is the real one, because "is this shell busy" is exactly the question a
 * fake probe would answer for itself.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { attachTerminal, disposeAllTerminals } from '@/server/lib/terminal/runtime.server';
import { terminalStore, type TerminalStore, type TerminalTimeout } from '@/server/lib/terminal/store';
import { countLiveTerminals, listTerminals } from '@/server/lib/terminal/liveness.server';
import type { TerminalSession, TerminalViewer } from '@/server/lib/terminal/session.server';
import { join } from 'node:path';
import { describePosix, testPosix } from '@/test-support/platform';

/** A root to hang POSIX-agnostic fixture paths off; `join` supplies the separator. */
const SRV = join('/', 'srv');

/** A record shaped enough for `snapshotOf`/liveness; no PTY is involved. */
function fakeSession(over: Partial<TerminalSession> & { id: string }): TerminalSession {
  return {
    cwd: '/tmp',
    shell: '/bin/sh',
    term: undefined as unknown as Bun.Terminal,
    proc: null,
    history: { replay: () => '' } as unknown as TerminalSession['history'],
    viewers: new Set(),
    cols: 80,
    rows: 24,
    replayCols: 80,
    replayRows: 24,
    status: 'running',
    exitCode: null,
    signal: null,
    lastActivity: Date.now(),
    ...over,
  };
}

const viewer = (): TerminalViewer => ({ send: () => true, drop: () => {} });

describe('terminalStore', () => {
  test('is one object per process, so a reload keeps the shells', () => {
    const first = terminalStore();
    expect(terminalStore()).toBe(first);
    expect(first.sessions).toBeInstanceOf(Map);
    expect(first.creating).toBeInstanceOf(Map);
    expect(first.resizeTimers).toBeInstanceOf(Map);
  });

  test('adopts the legacy globals a pre-object reload left behind', () => {
    const saved: (TerminalStore | undefined)[] = [globalThis.__ompChamberTerminalState];
    const savedSessions = globalThis.__ompChamberTerminals;
    const savedResizes = globalThis.__ompChamberTerminalResizes;
    const savedSweep = globalThis.__ompChamberTerminalSweep;
    const savedCleanup = globalThis.__ompChamberTerminalCleanupInstalled;

    const legacySessions = new Map<string, TerminalSession>([['kept', fakeSession({ id: 'kept' })]]);
    const legacyResizes = new Map<string, TerminalTimeout>([['kept', 7 as unknown as TerminalTimeout]]);
    try {
      globalThis.__ompChamberTerminalState = undefined;
      globalThis.__ompChamberTerminals = legacySessions;
      globalThis.__ompChamberTerminalResizes = legacyResizes;
      globalThis.__ompChamberTerminalSweep = undefined;
      globalThis.__ompChamberTerminalCleanupInstalled = true;

      const store = terminalStore();
      expect(store.sessions).toBe(legacySessions); // the live shell survives
      expect(store.resizeTimers).toBe(legacyResizes);
      expect(store.cleanupInstalled).toBe(true);
      expect(store.creating.size).toBe(0);
      expect(terminalStore()).toBe(store);
    } finally {
      globalThis.__ompChamberTerminalState = saved[0];
      globalThis.__ompChamberTerminals = savedSessions;
      globalThis.__ompChamberTerminalResizes = savedResizes;
      globalThis.__ompChamberTerminalSweep = savedSweep;
      globalThis.__ompChamberTerminalCleanupInstalled = savedCleanup;
    }
  });

  test('a legacy global that is not a Map is ignored, not adopted', () => {
    const savedState = globalThis.__ompChamberTerminalState;
    const savedSessions = globalThis.__ompChamberTerminals;
    try {
      globalThis.__ompChamberTerminalState = undefined;
      globalThis.__ompChamberTerminals = 'not-a-map' as unknown as Map<string, TerminalSession>;
      const store = terminalStore();
      expect(store.sessions).toBeInstanceOf(Map);
      expect(store.sessions.size).toBe(0);
    } finally {
      globalThis.__ompChamberTerminalState = savedState;
      globalThis.__ompChamberTerminals = savedSessions;
    }
  });
});

describePosix('one record per id, one creation per id', () => {
  const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

  afterAll(() => {
    disposeAllTerminals();
  });

  test('two concurrent attaches for a new id share one shell', async () => {
    const id = newId('dedupe');
    const [a, b] = await Promise.all([
      attachTerminal(viewer(), { id, cols: 80, rows: 24 }),
      attachTerminal(viewer(), { id, cols: 80, rows: 24 }),
    ]);

    const session = terminalStore().sessions.get(id);
    expect(session).toBeDefined();
    // The discriminator: a rival session would have taken one viewer each, and
    // the loser's shell would have been left unreachable behind the record.
    expect(session!.viewers.size).toBe(2);
    expect(a.snapshot.id).toBe(id);
    expect(b.snapshot.id).toBe(id);
    expect(a.snapshot.status).toBe('running');
    expect(a.snapshot.shell).toBe(session!.shell);
    expect(a.snapshot.cols).toBe(80);
    expect(a.snapshot.rows).toBe(24);
  });

  test('a later attach reuses the record instead of spawning a second shell', async () => {
    const id = newId('reuse');
    const first = await attachTerminal(viewer(), { id, cols: 100, rows: 30 });
    const pid = terminalStore().sessions.get(id)!.proc!.pid;
    const second = await attachTerminal(viewer(), { id, cols: 100, rows: 30 });

    expect(terminalStore().sessions.get(id)!.proc!.pid).toBe(pid);
    expect(terminalStore().sessions.get(id)!.viewers.size).toBe(2);
    expect(second.snapshot).toEqual(first.snapshot);
    expect(terminalStore().creating.has(id)).toBe(false); // the in-flight slot is released
  });
});

describe('countLiveTerminals', () => {
  const ids: string[] = [];
  let liveChild: Bun.Subprocess | null = null;

  /**
   * Count with ONLY the given records in the store.
   *
   * The store is process-wide, so whatever another suite (or this file's other
   * describe) left behind would otherwise be counted as this test's shells.
   */
  async function countingOnly(...sessions: TerminalSession[]): Promise<number> {
    const store = terminalStore();
    const saved = new Map(store.sessions);
    store.sessions.clear();
    for (const session of sessions) store.sessions.set(session.id, session);
    try {
      return await countLiveTerminals();
    } finally {
      store.sessions.clear();
      for (const [id, session] of saved) store.sessions.set(id, session);
    }
  }

  function withSessions(...sessions: TerminalSession[]): void {
    for (const session of sessions) {
      ids.push(session.id);
      terminalStore().sessions.set(session.id, session);
    }
  }

  afterAll(() => {
    for (const id of ids) terminalStore().sessions.delete(id);
    liveChild?.kill();
  });

  test('no sessions means nothing is live', async () => {
    expect(await countingOnly()).toBe(0);
  });

  test('exited shells and shells with no process are not budgeted', async () => {
    expect(
      await countingOnly(
        fakeSession({ id: 'corpse', status: 'exited', exitCode: 0 }),
        fakeSession({ id: 'record-only', proc: null }),
      ),
    ).toBe(0);
  });

  testPosix('a running shell with a live process is counted', async () => {
    liveChild = Bun.spawn(['sleep', '30'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    withSessions(
      fakeSession({ id: 'busy', proc: { pid: liveChild.pid } as unknown as Bun.Subprocess }),
      fakeSession({ id: 'corpse-2', status: 'exited' }),
    );
    expect(await countLiveTerminals()).toBe(1);
  });
});

describe('listTerminals', () => {
  const ids: string[] = [];

  function seed(session: TerminalSession): TerminalSession {
    ids.push(session.id);
    terminalStore().sessions.set(session.id, session);
    return session;
  }

  afterAll(() => {
    for (const id of ids) terminalStore().sessions.delete(id);
  });

  test('no scope lists every session, snapshotted', async () => {
    const exited = seed(
      fakeSession({ id: 'listed-exited', cwd: '/srv/one', status: 'exited', exitCode: 3, signal: 'SIGHUP' }),
    );
    const snapshots = await listTerminals();
    const mine = snapshots.find((snapshot) => snapshot.id === exited.id)!;
    expect(mine.cwd).toBe('/srv/one');
    expect(mine.status).toBe('exited');
    expect(mine.exitCode).toBe(3);
    expect(mine.signal).toBe('SIGHUP');
    expect(mine.busy).toBe(false);
    expect(mine.bunVersion).toBe(Bun.version);
    expect(mine.replayCols).toBe(80);
  });

  test('a scope keeps the root, its children, and drops a name-prefix sibling', async () => {
    // Built with `join`, not a literal `/srv/work`: the scope test compares
    // against `path.sep`, so a POSIX-spelled fixture can never be inside a
    // Windows-spelled scope and the case fails for a reason the code under test
    // does not have.
    const root = join(SRV, 'work');
    seed(fakeSession({ id: 'sc-root', cwd: root }));
    seed(fakeSession({ id: 'sc-child', cwd: join(root, 'app') }));
    seed(fakeSession({ id: 'sc-sibling', cwd: join(SRV, 'work-other') }));

    const listed = (await listTerminals(root, null)).map((snapshot) => snapshot.id);
    expect(listed).toContain('sc-root');
    expect(listed).toContain('sc-child');
    expect(listed).not.toContain('sc-sibling');
  });

  test('a repo narrows the scope to that subdirectory', async () => {
    const work = join(SRV, 'work');
    seed(fakeSession({ id: 'rp-in', cwd: join(work, 'pkg') }));
    seed(fakeSession({ id: 'rp-out', cwd: join(work, 'pkg2') }));
    // Seeded HERE: the `.` case needs a session at the root itself, and taking
    // it from another test would make this one depend on that test having run.
    const root = seed(fakeSession({ id: 'rp-root', cwd: work }));

    const listed = (await listTerminals(work, 'pkg')).map((snapshot) => snapshot.id);
    expect(listed).toContain('rp-in');
    expect(listed).not.toContain('rp-out');
    // `.` means the root itself, not a child named `.`.
    expect((await listTerminals(work, '.')).map((snapshot) => snapshot.id)).toContain(root.id);
  });

  testPosix('a running shell with a live process is reported busy', async () => {
    const child = Bun.spawn(['sleep', '30'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    try {
      const id = seed(
        fakeSession({ id: 'live-busy', cwd: '/srv/live', proc: { pid: child.pid } as unknown as Bun.Subprocess }),
      ).id;
      const mine = (await listTerminals('/srv/live')).find((snapshot) => snapshot.id === id)!;
      expect(mine.busy).toBe(true);
      // A session with no process is never asked, so it is never marked busy.
      const idle = seed(fakeSession({ id: 'live-idle', cwd: '/srv/live' }));
      const idleSnapshot = (await listTerminals('/srv/live')).find((snapshot) => snapshot.id === idle.id)!;
      expect(idleSnapshot.busy).toBe(false);
    } finally {
      child.kill();
    }
  });
});
