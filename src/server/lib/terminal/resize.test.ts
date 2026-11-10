/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A resize moves the PTY *and* the grid the retained history is replayed at.
 *
 * The replay size used to be frozen at the session's spawn size. That is wrong
 * the moment the panel is resized: the history is the shell's screen stream, and
 * after a resize the shell's screen is the new grid, so replaying at the old one
 * re-wraps every line written since. Measured on the real panel: after a resize
 * each reload laid the history out at the old 40×31, then fitted to 41×47, so the
 * transcript shifted and the shell redrew its prompt on the resize that followed
 * — one more block of history per reload, which is exactly the "the rows march
 * down on every reload" report.
 *
 * The records here are fakes (no PTY): the decision is the session's, and the
 * probe is the real one because "did the size change" is what the test is about.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { resizeTerminal } from '@/server/lib/terminal/runtime.server';
import { terminalStore, type TerminalStore } from '@/server/lib/terminal/store';
import { createTerminalOutputQueue } from '@/server/lib/terminal/output';
import type { TerminalSession } from '@/server/lib/terminal/session.server';

function fakeSession(over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'resize-test',
    cwd: '/tmp',
    shell: '/bin/sh',
    term: { resize: () => {}, write: () => {} } as unknown as TerminalSession['term'],
    proc: null,
    history: { append: () => {}, replay: () => new Uint8Array(), size: () => 0 } as unknown as TerminalSession['history'],
    output: createTerminalOutputQueue(() => {}),
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

function store(): TerminalStore {
  return terminalStore();
}

afterEach(() => {
  const { sessions, resizeTimers } = store();
  for (const timer of resizeTimers.values()) clearTimeout(timer);
  resizeTimers.clear();
  for (const session of sessions.values()) session.output.dispose();
  sessions.clear();
});

describe('resizeTerminal', () => {
  test('moves the PTY and the replay grid together', () => {
    const session = fakeSession();
    store().sessions.set(session.id, session);

    resizeTerminal(session.id, 41, 47);

    expect(session.cols).toBe(41);
    expect(session.rows).toBe(47);
    // The replay follows, or every reload re-wraps the history at the old size.
    expect(session.replayCols).toBe(41);
    expect(session.replayRows).toBe(47);
  });

  test('does nothing for the size the session already has', () => {
    let resizes = 0;
    const session = fakeSession({
      term: { resize: () => { resizes += 1; }, write: () => {} } as unknown as TerminalSession['term'],
    });
    store().sessions.set(session.id, session);

    resizeTerminal(session.id, 80, 24);

    expect(resizes).toBe(0);
  });

  test('clamps a grid to the protocol bounds before applying it', () => {
    const session = fakeSession();
    store().sessions.set(session.id, session);

    resizeTerminal(session.id, 1, 100_000);

    expect(session.cols).toBe(2);
    expect(session.rows).toBe(500);
    expect(session.replayCols).toBe(2);
    expect(session.replayRows).toBe(500);
  });
});
