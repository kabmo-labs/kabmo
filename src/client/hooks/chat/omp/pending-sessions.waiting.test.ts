/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pending store's WAITING rules.
 *
 * A held prompt's row is the only thing on screen for a chat that has no
 * transcript and no omp id, so the store has to keep it for as long as the wait
 * lasts — and drop the cue the moment the wait ends, or the row keeps claiming
 * something the server no longer holds.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  adoptPendingSession,
  listPendingSessions,
  markPendingSessionSent,
  reconcilePendingSessions,
  releasePendingSession,
  startPendingSession,
  subscribePendingSessions,
} from '@/client/hooks/chat/omp/pending-sessions';
import {
  clearPendingSessionWaiting,
  markPendingSessionDraft,
  markPendingSessionWaiting,
  pendingSessionWait,
} from '@/client/hooks/chat/omp/pending-waiting';

afterEach(() => {
  for (const entry of listPendingSessions()) releasePendingSession(entry.id);
});

describe('pending session waiting state', () => {
  test('a held prompt keeps its row past the settle window', () => {
    const id = startPendingSession(1);
    markPendingSessionWaiting(id, { waitId: 'wait-1', dependsOn: 'sess-a', dependsOnTitle: 'Session A' });

    // Far past PENDING_SETTLE_MS, which is the bound a SENT prompt gets.
    reconcilePendingSessions({
      listed: new Set(),
      running: new Set(),
      activeId: null,
      now: Date.now() + 10 * 60_000,
    });
    expect(listPendingSessions().map((entry) => entry.id)).toContain(id);
  });

  // The contrast case: a SENT prompt with no wait behind it is released on the
  // settle window, which is what makes the waiting rule a deliberate exception
  // rather than a disabled timer.
  test('an ordinary sent prompt still expires on the settle window', () => {
    const id = startPendingSession(1);
    markPendingSessionSent(id);
    reconcilePendingSessions({ listed: new Set(), running: new Set(), activeId: null, now: Date.now() + 10 * 60_000 });
    expect(listPendingSessions().map((entry) => entry.id)).not.toContain(id);
  });

  test('clearing the wait keeps the row but drops the cue', () => {
    const id = startPendingSession(1);
    markPendingSessionWaiting(id, { waitId: 'wait-1', dependsOn: 'sess-a', dependsOnTitle: 'Session A' });
    clearPendingSessionWaiting(id);
    expect(pendingSessionWait(id)).toBeNull();
    expect(listPendingSessions().map((entry) => entry.id)).toContain(id);
  });

  // Cancelling keeps the chat: the prompt's text is written back into that
  // chat's composer, so the row the user returns to must still exist — and it
  // must survive the settle pass that a SENT prompt would expire, because it is
  // an unsent draft again.
  test('a cancelled wait becomes an unsent draft that keeps its row', () => {
    const id = startPendingSession(1);
    markPendingSessionWaiting(id, { waitId: 'wait-1', dependsOn: 'sess-a', dependsOnTitle: 'A' });

    markPendingSessionDraft(id);
    expect(pendingSessionWait(id)).toBeNull();
    expect(listPendingSessions().find((entry) => entry.id === id)?.sentAt).toBeNull();
  });

  // The wait ends where the spawn answers: the new row is a real session from
  // that moment, so a cue carried across would say it is still held.
  test('adoption drops the waiting cue', () => {
    const id = startPendingSession(1);
    markPendingSessionWaiting(id, { waitId: 'wait-1', dependsOn: 'sess-a', dependsOnTitle: 'A' });
    adoptPendingSession(id, 'omp-session-9', 1);
    expect(pendingSessionWait('omp-session-9')).toBeNull();
  });

  // The cue is re-stamped from the server list on every publish, so an identical
  // write must be a no-op — otherwise every sidebar re-renders on every frame.
  test('re-stamping the same wait does not notify', () => {
    const id = startPendingSession(1);
    const wait = { waitId: 'wait-1', dependsOn: 'sess-a', dependsOnTitle: 'A' };
    markPendingSessionWaiting(id, wait);
    let notifications = 0;
    const stop = subscribePendingSessions(() => { notifications += 1; });
    markPendingSessionWaiting(id, { ...wait });
    stop();
    expect(notifications).toBe(0);
  });
});
