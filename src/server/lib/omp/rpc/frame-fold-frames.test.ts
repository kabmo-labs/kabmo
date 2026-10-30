/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The frames whose fold is a SESSION-state decision rather than a trigger.
 *
 * Split from `frame-fold.test.ts` by subject: that file pins WHEN the
 * auto-title trigger fires, while these three pin what a frame does to the row
 * the sidebar draws and to the caches that describe the session file. Each
 * expectation is a defect that shipped once — a spinner that never stopped, a
 * title that did not appear until an unrelated tool call republished, and an
 * idle-looking session in the middle of a compaction.
 */

import { describe, expect, test } from 'bun:test';

import { foldSessionFrame } from '@/server/lib/omp/rpc/frame-fold';
import { releasesStreamRowOnPromptResult } from '@/shared/lib/omp/session/stream-heal.server';
import { makeHost } from '@/server/lib/omp/rpc/frame-fold-host.test-util';

/**
 * The `prompt_result` frame is where omp reports `agentInvoked`, and the
 * dispatch-time `stream` row hangs on it.
 *
 * The shipped defect: the chamber's own `/chamber-mode` extension (the
 * composer's Plan/Goal toggles) acks a BARE `{success:true}` — no
 * `agentInvoked` — and reports `agentInvoked:false` on this frame instead. The
 * dispatcher read that bare ack as a run, armed the awaiting-agent-start
 * deadline, and left the row `stream` with a LIVE owner, which
 * `healStaleStreamStatuses` can never reach. The sidebar spinner turned
 * forever. Reproduced end to end against the real omp child before the fix.
 */
describe('releasesStreamRowOnPromptResult', () => {
  const live = { streaming: false, sessionId: 's1' };

  test('releases the row for a prompt that opened no turn', () => {
    expect(releasesStreamRowOnPromptResult({ agentInvoked: false }, live)).toBe(true);
  });

  test('never releases a row for a prompt that DID open a turn', () => {
    // omp's own trailing `prompt_result` for a real run carries `true`.
    expect(releasesStreamRowOnPromptResult({ agentInvoked: true }, live)).toBe(false);
  });

  test('a frame with no agentInvoked field is not proof of anything', () => {
    // An older omp, or any other prompt_result shape. Reading absence as
    // "no turn" would clear the spinner of a run that is working.
    expect(releasesStreamRowOnPromptResult({}, live)).toBe(false);
    expect(releasesStreamRowOnPromptResult({ agentInvoked: undefined }, live)).toBe(false);
  });

  test('keeps the running turn’s row when the command lands mid-turn', () => {
    // Measured: a `/chamber-mode` sent while a turn streams is answered in
    // ~20 ms from omp's command loop with the turn STILL running. Clearing
    // here would blank the spinner of a run that is demonstrably working.
    expect(releasesStreamRowOnPromptResult({ agentInvoked: false }, { streaming: true, sessionId: 's1' })).toBe(false);
  });

  test('does nothing before the session id is known', () => {
    expect(releasesStreamRowOnPromptResult({ agentInvoked: false }, { streaming: false, sessionId: '' })).toBe(false);
  });
});

/**
 * A rename writes the title SLOT in place, which no mtime-keyed scan can see.
 *
 * The sidebar therefore has to be republished from this frame, not only from
 * the turn-boundary signals: measured, a session named by its own run kept
 * `New Session - <timestamp>` in the list while the header already showed the
 * title, until an unrelated tool call happened to republish.
 */
describe('session_info_update', () => {
  test('drops the sidebar scan cache, which the in-place title write cannot invalidate itself', () => {
    // The title is rewritten in a fixed-width slot INSIDE the session file, so
    // the mtime the scan cache keys on does not move. Without this the list
    // kept `New Session - <timestamp>` while the header already showed the
    // title, until an unrelated tool call happened to republish.
    globalThis.__kabmoSidebarDataCache = {
      data: {} as never,
      expiresAt: Date.now() + 60_000,
      inFlight: null,
    };

    const host = makeHost({ sessionId: 's1' });
    const result = foldSessionFrame(host, { type: 'session_info_update', title: 'A new name' });

    expect(result.suppressForward).toBe(false);
    expect(globalThis.__kabmoSidebarDataCache?.expiresAt).toBe(0);
  });
});

/**
 * Both compaction pairs drive `compacting`, and the session-file caches.
 *
 * `auto_*` is omp's own threshold pass; `manual_*` is one the user asked for
 * (the `compact` command, a typed `/compact`, an extension's `ctx.compact()`).
 * 18.14.0 emits the manual pair — measured against a real child: a `/compact`
 * prompt answers `manual_compaction_start`, then `_end`, then a `command_output`
 * carrying omp's own sentence. Before it a typed `/compact` emitted nothing, so
 * the flag stayed false and `isBusy()` called the session idle mid-pass.
 */
describe('compaction frames', () => {
  test('the auto pair sets and clears `compacting`', () => {
    const host = makeHost({ sessionId: 's1' });

    foldSessionFrame(host, { type: 'auto_compaction_start', reason: 'context-full', action: 'context-full' });
    expect(host.compacting).toBe(true);

    foldSessionFrame(host, { type: 'auto_compaction_end', aborted: false, willRetry: false });
    expect(host.compacting).toBe(false);
  });

  test('the manual pair does too, and drops the session-file caches on the way out', () => {
    const host = makeHost({ sessionId: 's1' });

    foldSessionFrame(host, { type: 'manual_compaction_start' });
    expect(host.compacting).toBe(true);

    // The compaction rewrote the transcript, so a cached scan would keep
    // serving the pre-compaction read of the same file — the scan cache is
    // keyed on `(size, mtimeMs)`, and omp rewrites the file in place.
    globalThis.__kabmoSessionScanCache = { version: 3, entries: new Map([['/tmp/s.jsonl', {} as never]]) };
    foldSessionFrame(host, { type: 'manual_compaction_end', aborted: false, skipped: true });

    expect(host.compacting).toBe(false);
    expect(globalThis.__kabmoSessionScanCache.entries.size).toBe(0);
  });

});
