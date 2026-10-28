/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a completed tool call republishes, and — the load-bearing half — what it
 * does NOT.
 *
 * The shipped shape republished the whole `sidebar` structure here: every
 * folder and session, re-scanned from disk. Measured on the author's install,
 * that is 216 KB over 731 sessions PER TOOL CALL, against 87 bytes for the
 * activity entry it actually needed to carry, and it is what made a phone's
 * stream feel slow. These cases pin the split:
 *
 *   - the activity signal fires per tool call;
 *   - the STRUCTURE signal does not, because nothing about the LIST changed (a
 *     new session's file is the watcher's `rename` event, a rename is
 *     `session_info_update`, and the turn boundary is `settleTerminalRun`);
 *   - the data signal still fires, because a tool result IS a transcript entry.
 *
 * Split from `frame-fold.test.ts` when the two together crossed the repo's
 * per-file ceiling.
 */

import { describe, expect, test } from 'bun:test';

import { foldSessionFrame, type SessionFrameHost } from '@/server/lib/omp/rpc/frame-fold';
import { onRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { ModeMirror } from '@/server/lib/omp/rpc/mode-mirror';

/** The same minimal host the sibling suite uses. */
function makeHost(overrides: Partial<SessionFrameHost> = {}): SessionFrameHost {
  return {
    sessionId: '',
    autoTitleWindowUntil: 0,
    autoTitleClaims: 0,
    autoTitleDispatch: null,
    autoTitlePending: true,
    autoTitleRequested: false,
    promptRunning: false,
    streaming: false,
    compacting: false,
    awaitingAgentStart: false,
    awaitingAgentStartDeadline: 0,
    continuationGraceUntil: 0,
    proc: { sendCommand: async () => undefined as never },
    emit() {},
    trackUiDialog() {},
    observeSubagent() {},
    syncRunModel() {},
    modeMirror: new ModeMirror(),
    isAlive: () => true,
    isBusy: () => false,
    send: async () => undefined,
    ...overrides,
  };
}

/**
 * The `tool_execution_end` frame is what moves a running session's sidebar row
 * between turn boundaries — and it must move ONLY the two live fields.
 *
 * The shipped shape republished the whole `sidebar` structure here: every
 * folder and session, re-scanned from disk. Measured on the author's install,
 * that is 216 KB over 731 sessions PER TOOL CALL, against 87 bytes for the
 * activity entry it actually needed to carry — and it is what made a phone's
 * stream feel slow. The rules pinned below are the ones that make the smaller
 * payload sufficient:
 *
 *   - the activity signal fires per tool call;
 *   - the STRUCTURE signal does not, because nothing about the list changed (a
 *     new session's file is the watcher's `rename` event, a rename is
 *     `session_info_update`, and the turn boundary is `settleTerminalRun`);
 *   - the data signal still fires, because a tool result IS a transcript entry.
 */
describe('tool_execution_end publishes activity, never the structure', () => {
  test('raises the activity signal and leaves the structure alone', () => {
    const seen: string[] = [];
    const off = onRealtimeSignal((event) => seen.push(event.signal));
    try {
      const host = makeHost({ sessionId: 's1' });
      foldSessionFrame(host, { type: 'tool_execution_end' });
    } finally {
      off();
    }

    expect(seen).toContain('sidebar-activity');
    expect(seen).not.toContain('sidebar-structure');
    // The transcript grew, so the session's data topics re-read.
    expect(seen).toContain('session-data-dirty');
    expect(seen).toContain('workspace-dirty');
  });

  test('still publishes the structure at the turn boundary', () => {
    // The other half of the split: the final answer appends after the last tool
    // call, and the run's own settle is where the list catches up. Asserted
    // through the scan cache, which is the observable a structure publish
    // leaves behind (`settleTerminalRun` calls the publisher directly rather
    // than raising the signal).
    globalThis.__kabmoSidebarDataCache = {
      data: {} as never,
      expiresAt: Date.now() + 60_000,
      inFlight: null,
    };

    const host = makeHost({ sessionId: 's1' });
    foldSessionFrame(host, { type: 'agent_end', isTerminal: true, messages: [] });

    expect(globalThis.__kabmoSidebarDataCache?.expiresAt).toBe(0);
  });
});
