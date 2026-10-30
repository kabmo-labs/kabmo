/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Wiring of the auto-title trigger into the frame fold.
 *
 * The trigger itself is covered by `session/auto-title.server.test.ts`; what
 * these tests pin is WHEN the fold reaches it. That timing is load-bearing and
 * was measured against omp 18.3.0: `agent_start` fires before the turn opens, so
 * the transcript is still empty there and a title asked for at that point comes
 * back "Could not generate a session title".
 *
 * The host carries no session id, so `triggerAutoSessionTitle` returns before it
 * touches the settings database. The stage flags it flips on the way are the
 * observable proof that the branch was reached.
 */

import { describe, expect, test } from 'bun:test';

import { foldSessionFrame, type SessionFrameHost } from '@/server/lib/omp/rpc/frame-fold';
import { releasesStreamRowOnPromptResult } from '@/shared/lib/omp/session/stream-heal.server';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import { ModeMirror } from '@/server/lib/omp/rpc/mode-mirror';

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

/** Fold one frame and report the flags the trigger leaves behind. */
function fold(host: SessionFrameHost, event: AgentEvent): void {
  foldSessionFrame(host, event);
}

describe('auto-title trigger wiring', () => {
  test('asks for the title on the first settled user message', () => {
    const host = makeHost();
    fold(host, { type: 'message_end', message: { role: 'user', content: 'fix the sidebar' } });

    expect(host.autoTitleRequested).toBe(true);
    // The early attempt leaves the eligibility latch alone so the run end can
    // still retry it.
    expect(host.autoTitlePending).toBe(true);
  });

  test('does not ask on an assistant or tool message', () => {
    for (const role of ['assistant', 'toolResult']) {
      const host = makeHost();
      fold(host, { type: 'message_end', message: { role, content: 'x' } });
      expect(host.autoTitleRequested).toBe(false);
    }
  });

  test('asks for the title on a /skill: turn, which arrives as role "custom"', () => {
    // Measured against a real child: a `/skill:<name>` turn is a
    // `message_end` with `role: "custom"` and `customType: "skill-prompt"`, NOT
    // `role: "user"`. A gate that only knew the user role never fired for one,
    // so a session opened with a skill stayed unnamed forever.
    const host = makeHost();
    fold(host, { type: 'message_end', message: { role: 'custom', customType: 'skill-prompt' } });

    expect(host.autoTitleRequested).toBe(true);
    expect(host.autoTitlePending).toBe(true);
  });

  test('a custom message of another kind still does not ask', () => {
    const host = makeHost();
    fold(host, { type: 'message_end', message: { role: 'custom', customType: 'system-prompt-digest' } });
    expect(host.autoTitleRequested).toBe(false);
  });

  test('does not ask at agent_start, where the transcript is still empty', () => {
    // The whole reason the trigger is not on this frame: omp pushes
    // `agent_start` before the turn opens, so a `/rename` here reads
    // `messageCount: 0` and omp declines to generate anything.
    const host = makeHost();
    fold(host, { type: 'agent_start' });

    expect(host.autoTitleRequested).toBe(false);
    expect(host.autoTitlePending).toBe(true);
  });

  test('resets the early-attempt flag so a later run gets its own try', () => {
    const host = makeHost();
    fold(host, { type: 'message_end', message: { role: 'user', content: 'first' } });
    expect(host.autoTitleRequested).toBe(true);

    // A run that opens after an aborted one (which skipped the settle attempt)
    // must still be able to ask.
    fold(host, { type: 'agent_start' });
    expect(host.autoTitleRequested).toBe(false);
  });

  test('retries at the terminal run end and consumes the latch there', () => {
    const host = makeHost();
    fold(host, { type: 'message_end', message: { role: 'user', content: 'first' } });

    fold(host, { type: 'agent_end', isTerminal: true, messages: [] });

    // Consumed: this conversation is never titled again after the fallback.
    expect(host.autoTitlePending).toBe(false);
  });

  test('skips the fallback for an aborted run', () => {
    // A stopped turn is not a settle: the next completed run is a better moment
    // than a half-run transcript, and the latch must survive for it.
    const host = makeHost();
    fold(host, { type: 'message_end', message: { role: 'user', content: 'first' } });
    fold(host, {
      type: 'agent_end',
      isTerminal: true,
      messages: [{ role: 'assistant', stopReason: 'aborted' }],
    });

    expect(host.autoTitlePending).toBe(true);
  });

  test('does not retry on a non-terminal agent_end', () => {
    const host = makeHost();
    fold(host, { type: 'agent_end', isTerminal: false, messages: [] });

    expect(host.autoTitlePending).toBe(true);
  });
});

/**
 * The Kabmo's own background `/rename` answers on `prompt_result` with
 * `agentInvoked:false` — auto-title fires it right after the first settled user
 * message, and `rename-with-ai` sends the same command.
 *
 * The shipped defect: forwarding that frame tells the CLIENT its prompt opened
 * no turn, and the client's fold settles the optimistic turn — blanking the
 * docked generating indicator, releasing the `stream` mark the sidebar spinner
 * hangs on and dropping the optimistic user mark, so the turn's echo was
 * appended beside the bubble it stood for. Measured on a fresh session before
 * the fix: the indicator died ~450 ms into a 20 s run and the first prompt was
 * stored twice. The run is the attribution: nothing that opened no turn while
 * the operator's own turn STREAMS can be that turn's settle.
 */
describe('a non-invoking prompt_result never reaches the client mid-run', () => {
  /** A host mid-run with the rename window armed, exactly as auto-title leaves it. */
  function midRunHost(): SessionFrameHost {
    return makeHost({
      sessionId: 's1',
      streaming: true,
      promptRunning: true,
      autoTitleWindowUntil: Date.now() + 60_000,
    });
  }

  test('suppresses the rename’s ack instead of settling the live turn', () => {
    const host = midRunHost();
    const result = foldSessionFrame(host, { type: 'prompt_result', agentInvoked: false });

    expect(result.suppressForward).toBe(true);
    // The turn is still streaming: its flags must survive the frame.
    expect(host.promptRunning).toBe(true);
    expect(host.awaitingAgentStart).toBe(false);
  });

  test('suppresses it even when the rename window was NOT armed in time', () => {
    // The leak this rule exists for. The window is armed around the `/rename`,
    // and omp answers the command within ~3 ms, so the ack can win that race
    // (measured) — and the client then folded it as "the run settled" while the
    // answer kept streaming. Request-window attribution cannot cover a sender
    // that raced its own arm; the live run can.
    const host = midRunHost();
    host.autoTitleWindowUntil = 0;

    const result = foldSessionFrame(host, { type: 'prompt_result', agentInvoked: false });

    expect(result.suppressForward).toBe(true);
    expect(host.promptRunning).toBe(true);
  });

  test('suppresses an auxiliary result that never claimed a window at all', () => {
    // A mode toggle, `/reload-plugins`, a peer instance's command: none of them
    // arms the auto-title window, and all of them answer on this frame.
    const host = makeHost({ sessionId: 's1', streaming: true, promptRunning: true });

    expect(foldSessionFrame(host, { type: 'prompt_result', agentInvoked: false }).suppressForward).toBe(true);
  });

  test('still forwards the operator’s own builtin result when no turn runs', () => {
    // The case the frame exists for: a `/usage` the operator typed must settle
    // the optimistic turn, even inside a rename window.
    const host = makeHost({ sessionId: 's1', promptRunning: true, autoTitleWindowUntil: Date.now() + 60_000 });
    const result = foldSessionFrame(host, { type: 'prompt_result', agentInvoked: false });

    expect(result.suppressForward).toBe(false);
    expect(host.promptRunning).toBe(false);
  });

  test('a real run’s own prompt_result still settles normally', () => {
    // omp's trailing `prompt_result` for a real run carries `true`; it must pass
    // through even mid-run.
    const host = midRunHost();
    expect(foldSessionFrame(host, { type: 'prompt_result', agentInvoked: true }).suppressForward).toBe(false);
  });
});

/**
 * omp's payload-less `model_changed`: a retry under `retry.fallbackChains` picks
 * the next eligible model when the primary fails, and it can swap MID-RUN. The
 * frame names nothing, so the fold asks the wrapper to re-read `get_state` and
 * rename the live run row — the sidebar and the generating indicator must name
 * the model the answer came from, not the one that was requested.
 */
describe('model_changed wiring', () => {
  test('asks the wrapper to re-read the model the child actually served with', () => {
    let synced = 0;
    const host = makeHost({ syncRunModel: () => { synced += 1; } });

    foldSessionFrame(host, { type: 'model_changed' });

    expect(synced).toBe(1);
  });

  test('still forwards the frame, so the client refreshes its own metadata', () => {
    const host = makeHost();
    expect(foldSessionFrame(host, { type: 'model_changed' }).suppressForward).toBe(false);
  });

  test('re-reads the model when a run opens, for a switch omp never announced', () => {
    // A fallback that landed between runs leaves `runModel` stale; the run's
    // opening frame is the last chance to correct it before the first token.
    let synced = 0;
    const host = makeHost({ sessionId: 's1', syncRunModel: () => { synced += 1; } });

    foldSessionFrame(host, { type: 'agent_start' });

    expect(synced).toBe(1);
  });
});

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
