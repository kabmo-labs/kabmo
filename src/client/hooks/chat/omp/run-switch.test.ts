/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which session arrivals are a SWITCH, and which are the same conversation.
 *
 * The distinction is silent when it is wrong: a switch drops the run's tool
 * bookkeeping (`toolResultsRef` / `lastToolMessageRef`), so every later
 * `tool_execution_update` / `tool_execution_end` has no target to pair onto and
 * the card freezes at `Running` for the rest of the session. Measured in
 * `wait.e2e.ts`: the settle spec read `Wait Running` for 30 s, and the browser
 * trace showed the map emptied between two progress frames of one call.
 *
 * The rule is pinned here as a table because the evidence differs per arrival and
 * only one of them is a pending id.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { isRunSwitch } from '@/client/hooks/chat/omp/run-switch';
import { adoptPendingSession, releasePendingSession, startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';

/** Every pending entry this file created, released afterwards. */
const created: string[] = [];

function pending(): string {
  const id = startPendingSession(1);
  created.push(id);
  return id;
}

afterEach(() => {
  for (const id of created.splice(0)) releasePendingSession(id);
});

describe('isRunSwitch', () => {
  test('a spawn adoption is NOT a switch, and is not consumed', () => {
    const from = pending();
    adoptPendingSession(from, 'omp-1', 1);
    // Twice: the rule must not claim the record — the session-state provider
    // owns the single claim and would refuse to migrate the pending slot.
    expect(isRunSwitch({ previous: from, sessionId: 'omp-1', attached: null })).toBe(false);
    expect(isRunSwitch({ previous: from, sessionId: 'omp-1', attached: null })).toBe(false);
  });

  test('a send that began with no pending id is NOT a switch once the stream is attached', () => {
    // The chat was opened from a workspace (`?folderId=` only), so the hook's
    // first id IS the spawned one and no adoption record can exist. The spawn
    // path connects before it writes the URL, so the attachment is the evidence.
    expect(isRunSwitch({ previous: null, sessionId: 'omp-2', attached: 'omp-2' })).toBe(false);
    expect(isRunSwitch({ previous: 'omp-1', sessionId: 'omp-2', attached: 'omp-2' })).toBe(false);
  });

  test('a session merely OPENED is a switch, because nothing dials it first', () => {
    // The mount probe attaches only AFTER this decision, so an unattached id is
    // a session the user clicked: its refs must be cleared and its live run
    // probed from scratch.
    expect(isRunSwitch({ previous: 'omp-1', sessionId: 'omp-2', attached: null })).toBe(true);
    // …and so is one whose stream is still on the session being left.
    expect(isRunSwitch({ previous: 'omp-1', sessionId: 'omp-2', attached: 'omp-1' })).toBe(true);
  });

  test('the same id is never a switch, whatever the attachment says', () => {
    // A re-render or a metadata refresh re-runs the effect's dependencies.
    expect(isRunSwitch({ previous: 'omp-1', sessionId: 'omp-1', attached: null })).toBe(false);
    expect(isRunSwitch({ previous: 'omp-1', sessionId: 'omp-1', attached: 'omp-1' })).toBe(false);
  });
});
