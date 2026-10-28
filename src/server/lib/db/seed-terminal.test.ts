/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** The terminal-session half of `seed.test.ts`: `clampTerminalSize`, the
 * viewer fan-out drop rule, the snapshot shape, and the process-group
 * signalling fallback — none of which need a PTY. Split verbatim from
 * `seed.test.ts` so both files stay under the repo's 350-line ceiling. */


/**
 * Mock seeding and the non-PTY half of the terminal session.
 *
 * `seed.ts` is the dataset every MOCK=true screenshot and demo depends on, and
 * its contract is *idempotence*: it re-asserts the demo rows on every start
 * instead of duplicating them, which is why the sidebar keeps the same five
 * chat titles and the same file tree after a restart. It is also destructive in
 * one place that is easy to miss — folder 1 is RENAMED to `kabmo` on every
 * seed — so that is pinned rather than assumed. Every test runs against a temp
 * SQLite file; the real Kabmo database is never opened.
 *
 * The `terminal/session.server.ts` helpers are pinned alongside because they
 * need no PTY: the viewer fan-out drop rule (a viewer that cannot keep up is
 * dropped, never skipped, or xterm's parser is left mid-sequence), the snapshot
 * shape, and the process-group signalling fallback for a session with no child.
 * Anything requiring a real PTY spawn is deliberately not tested here.
 */

import { describe, expect, test } from 'bun:test';

import {
  TERMINATION_GRACE_MS,
  TerminalRuntimeError,
  closeTerminalStream,
  fanOut,
  signalGroup,
  snapshotOf,
  type TerminalSession,
  type TerminalViewer,
} from '@/server/lib/terminal/session.server';
import { clampTerminalSize } from '@/shared/lib/workspace/terminal/protocol';
import { testPosix } from '@/test-support/platform';
describe('clampTerminalSize and session constants', () => {
  test('the termination grace period is one second', () => {
    expect(TERMINATION_GRACE_MS).toBe(1000);
  });

  test('a sane grid passes through and fractional values are truncated', () => {
    expect(clampTerminalSize(80, 24)).toEqual({ cols: 80, rows: 24 });
    expect(clampTerminalSize(80.9, 24.9)).toEqual({ cols: 80, rows: 24 });
  });

  test('out-of-range and non-finite values clamp to the PTY bounds', () => {
    expect(clampTerminalSize(0, 0)).toEqual({ cols: 2, rows: 1 });
    expect(clampTerminalSize(-5, -5)).toEqual({ cols: 2, rows: 1 });
    expect(clampTerminalSize(9999, 9999)).toEqual({ cols: 1000, rows: 500 });
    expect(clampTerminalSize(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ cols: 2, rows: 1 });
  });
});

describe('TerminalRuntimeError', () => {
  test('carries the client-visible code', () => {
    const error = new TerminalRuntimeError('capacity', 'too many terminals');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TerminalRuntimeError');
    expect(error.code).toBe('capacity');
    expect(error.message).toBe('too many terminals');
  });
});

describe('fanOut', () => {
  test('delivers the frame to every viewer that accepts it', () => {
    const frames: Array<string | Uint8Array> = [];
    const session = fakeSession([
      { send: (frame) => (frames.push(frame), true), drop: () => undefined },
    ]);
    fanOut(session, 'hello');
    expect(frames).toEqual(['hello']);
    expect(session.viewers.size).toBe(1);
  });

  test('a viewer that cannot keep up is dropped, not skipped', () => {
    let dropped = 0;
    const slow: TerminalViewer = { send: () => false, drop: () => void (dropped += 1) };
    const session = fakeSession([slow]);
    fanOut(session, 'x');
    expect(dropped).toBe(1);
    expect(session.viewers.size).toBe(0);
  });

  test('the slow viewer does not stop delivery to the healthy ones', () => {
    const received: string[] = [];
    const session = fakeSession([
      { send: () => false, drop: () => undefined },
      { send: (frame) => (received.push(String(frame)), true), drop: () => undefined },
    ]);
    fanOut(session, 'frame');
    expect(received).toEqual(['frame']);
    expect(session.viewers.size).toBe(1);
  });
});

describe('snapshotOf', () => {
  test('reports the session grid, status and the runtime versions', () => {
    const session = fakeSession([], {
      id: 't1',
      cwd: '/tmp',
      shell: '/bin/zsh',
      cols: 120,
      rows: 40,
      replayCols: 120,
      replayRows: 40,
    });
    expect(snapshotOf(session)).toEqual({
      id: 't1',
      cwd: '/tmp',
      shell: '/bin/zsh',
      cols: 120,
      rows: 40,
      status: 'running',
      exitCode: null,
      signal: null,
      bunVersion: Bun.version,
      // `process.version` is the Node version Bun emulates, not a real binary.
      nodeVersion: process.version,
      replayCols: 120,
      replayRows: 40,
    });
  });
});

describe('signalGroup / closeTerminalStream', () => {
  test('a session with no child is a no-op', () => {
    const session = fakeSession([]);
    expect(() => signalGroup(session, 'SIGTERM')).not.toThrow();
  });

  test('a child without a pid is signalled directly rather than by group', () => {
    const signals: string[] = [];
    const session = fakeSession([], { proc: { pid: undefined, kill: (s: string) => void signals.push(s) } as never });
    signalGroup(session, 'SIGINT');
    expect(signals).toEqual(['SIGINT']);
  });

  test('a child that refuses the signal does not throw', () => {
    const session = fakeSession([], {
      proc: {
        pid: undefined,
        kill: () => {
          throw new Error('ESRCH');
        },
      } as never,
    });
    expect(() => signalGroup(session, 'SIGKILL')).not.toThrow();
  });

  // A real pid goes through `killProcessTree`, not the child handle — that is
  // the whole point of the change: on POSIX the group is addressed, and on
  // Windows the tree is walked, while `proc.kill` reaches only the shell. This
  // asserts the routing, which is what a `proc.kill`-only implementation fails:
  // a session whose handle would accept a kill must NOT have it called when a
  // pid is present.
  testPosix('a child WITH a pid is terminated by its process group, not its handle', async () => {
    const child = Bun.spawn({ cmd: ['sleep', '30'], detached: true, stdout: 'ignore', stderr: 'ignore' });
    let handleKills = 0;
    const session = fakeSession([], {
      proc: {
        pid: child.pid,
        kill: () => void (handleKills += 1),
      } as never,
    });
    try {
      signalGroup(session, 'SIGKILL');
      // The group signal is what makes the real child exit; awaiting it is the
      // assertion, and bun's per-test timeout fails the case if it never lands.
      const code = await child.exited;
      expect(typeof code).toBe('number');
      expect(handleKills).toBe(0);
    } finally {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {}
    }
  });

  test('closing the terminal stream is best-effort', () => {
    let closed = 0;
    const session = fakeSession([], { term: { close: () => void (closed += 1) } as never });
    closeTerminalStream(session);
    expect(closed).toBe(1);

    const throwing = fakeSession([], {
      term: {
        close: () => {
          throw new Error('already closed');
        },
      } as never,
    });
    expect(() => closeTerminalStream(throwing)).not.toThrow();
  });
});

/** A terminal record with only the fields the pure helpers touch. */
function fakeSession(
  viewers: TerminalViewer[],
  overrides: Partial<TerminalSession> = {},
): TerminalSession {
  return {
    id: 't',
    cwd: '/tmp',
    shell: '/bin/sh',
    term: undefined as unknown as Bun.Terminal,
    proc: null,
    history: undefined as never,
    viewers: new Set(viewers),
    cols: 80,
    rows: 24,
    replayCols: 80,
    replayRows: 24,
    status: 'running',
    exitCode: null,
    signal: null,
    lastActivity: 0,
    ...overrides,
  };
}
