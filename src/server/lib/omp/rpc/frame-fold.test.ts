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
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import { makeHost } from '@/server/lib/omp/rpc/frame-fold-host.test-util';

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
