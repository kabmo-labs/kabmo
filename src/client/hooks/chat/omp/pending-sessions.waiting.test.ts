/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
  markPendingSessionWaiting,
  pendingSessionWait,
  releasePendingSessionByWait,
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

  test('a cancelled wait drops its row by the wait id', () => {
    const first = startPendingSession(1);
    const second = startPendingSession(1);
    markPendingSessionWaiting(first, { waitId: 'wait-1', dependsOn: 'sess-a', dependsOnTitle: 'A' });
    markPendingSessionWaiting(second, { waitId: 'wait-2', dependsOn: 'sess-b', dependsOnTitle: 'B' });

    releasePendingSessionByWait('wait-1');
    const ids = listPendingSessions().map((entry) => entry.id);
    expect(ids).not.toContain(first);
    expect(ids).toContain(second);
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
