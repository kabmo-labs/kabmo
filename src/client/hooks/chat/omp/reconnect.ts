/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Recover a run whose terminal frames were lost with the realtime channel.
 *
 * The reported failure: a streaming chat was left in a background tab, the
 * socket was torn down, the turn finished while nothing was reading, and the
 * user came back to an answer cut off mid-sentence with the docked indicator
 * already gone. Both halves of that state come from the same missing frames —
 * `message_end` never replaced the streaming row, and `agent_end` never
 * released the local generating flag — while the SERVER's `stream` row settled
 * normally, which is why the indicator stopped but the transcript did not.
 *
 * Two facts decide when this applies, and both are about the CHANNEL, not about
 * a run's bookkeeping:
 *
 * - frames can only have been missed if the socket was OPEN while a run was
 *   believed live and then went away. A send whose `connect()` dials a closed
 *   channel never meets that condition, so the optimistic turn it just mounted
 *   can never be settled by this path (the prompt is not even on the wire yet).
 * - the run must be over on the SERVER, asked through the same attach probe the
 *   mount path uses (`runIsOver`). `busy` is not a verdict there, and an
 *   unanswered probe settles nothing.
 *
 * Recovery is two steps and both are needed: settle the local run (release the
 * generating flag, drop the ids only a live stream would consume), then re-read
 * the committed transcript — the rows on screen are the stream's last PARTIAL
 * segment, and the session JSONL is the only record of the rest.
 */

import { useEffect, useRef } from 'preact/hooks';

import { realtimeClient } from '@/shared/lib/realtime/client';
import { runIsOver, type AgentRunProbe } from '@/client/hooks/chat/omp/run-liveness';

export interface ReconnectSettleDeps {
  /** The session on screen; null for a pending `new-…` chat (no child yet). */
  sessionId: string | null;
  /** Live "this page is showing a run" flag — owned or adopted. */
  isGeneratingRef: { current: boolean };
  /** The stream has spoken for that run (see `streamRunRef`). */
  streamRunRef: { current: boolean };
  /** The SERVER reports a run for this session (`session_stream_state`'s
   *  `stream` row, the same source the sidebar spinner reads). This is the
   *  evidence that a prompt was DISPATCHED, which is what makes frame loss
   *  possible — and it is the only signal available for a run whose own
   *  `agent_start` was the first frame lost. A prompt that has not reached the
   *  server yet has no row, so it is still excluded. */
  serverRunRef: { current: boolean };
  /** The run is over server-side: settle the local UI and re-read the
   *  committed transcript. */
  onSettled: () => void;
  /** Frames were LOST — called SYNCHRONOUSLY at the drop, not at the probe's
   *  answer. A run in flight when an open channel goes away has already lost
   *  whatever finished during the outage: its `message_end` went into the dead
   *  socket, and `agent_end` only materializes turns that stopped abnormally.
   *  The caller records it so the transcript is re-read when the run settles.
   *
   *  At the DROP, deliberately: the attach probe is a request, so a run can
   *  settle while it is in flight — measured as a flaky spec where `agent_end`
   *  arrived first, read a flag that was still false, and never reloaded. What
   *  is lost is a fact about the drop, not about the probe's answer. */
  onFramesLost: () => void;
}

/**
 * The channel facts this hook needs, held OUTSIDE the effect.
 *
 * The effect is keyed on the session id, and that id MOVES mid-run: a spawn
 * answers with omp's UUID a beat after the first prompt, so the URL — and this
 * effect — re-mounts. Local variables therefore lose the only two facts that
 * make the repair possible, measured on a real run: the tab went away during
 * the spawn adoption, the effect re-mounted inside the outage, `wasOpen` came
 * back `false`, and the drop was read as "a dial that never opened" — so
 * nothing was recorded and the transcript was never re-read.
 */
interface ChannelFacts {
  /** The channel was OPEN at the last transition we saw. */
  wasOpen: boolean;
  /** A run was in flight when it went away, so frames were lost. */
  missedFrames: boolean;
  /**
   * A run has been seen live for this session since it was last reconciled.
   *
   * A LATCH, not a live read, and that is the whole point: the client's
   * generating flag flickers false during a live run (measured: a `prompt_result`
   * folded as "settled", and the spawn-adoption window), and a drop that landed
   * in one of those beats was read as "no run in flight" — so nothing was
   * recorded and the transcript was never re-read, which is exactly the
   * cut-off answer this hook exists to repair.
   */
  sawRun: boolean;
  /** The session id `sawRun` belongs to, so a real switch resets it while a
   *  spawn ADOPTION (same conversation, new id) keeps it. */
  sessionId: string | null;
}

export function useReconnectSettle(deps: ReconnectSettleDeps): void {
  const { sessionId, isGeneratingRef, streamRunRef, serverRunRef, onSettled, onFramesLost } = deps;
  // Held in a ref: the caller rebuilds `onSettled` on every render (it closes
  // over the timeline's own callbacks), and an effect keyed on its identity
  // would re-subscribe constantly.
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const onFramesLostRef = useRef(onFramesLost);
  onFramesLostRef.current = onFramesLost;
  // Survives a re-mount, which is the whole point (see `ChannelFacts`).
  const factsRef = useRef<ChannelFacts | null>(null);

  // Latch the run evidence on EVERY render, before any effect runs: the flags
  // are refs, so a beat that flickers false would otherwise erase the only
  // proof a run existed when the channel went away.
  const facts = (factsRef.current ??= {
    wasOpen: realtimeClient.status() === 'open',
    missedFrames: false,
    sawRun: false,
    sessionId,
  });
  // Re-read the CHANNEL on every render, because this hook re-mounts and the
  // channel does not. Measured: the effect was re-created while the socket was
  // OPEN (a spawn adoption, a session-state re-render), the latch still said
  // `wasOpen:false` from before that, and the following drop was read as a dial
  // that never opened — so the repair never ran. Only the TRANSITION matters,
  // so reconciling here cannot invent a loss: `missedFrames` is still armed by
  // the subscriber alone.
  facts.wasOpen = realtimeClient.status() === 'open';
  if (isGeneratingRef.current || streamRunRef.current || serverRunRef.current) facts.sawRun = true;
  // A genuine switch (nothing live) starts over; an adoption keeps the latch.
  if (facts.sessionId !== sessionId) {
    if (!isGeneratingRef.current && !serverRunRef.current) facts.sawRun = false;
    facts.sessionId = sessionId;
  }

  useEffect(() => {
    if (!sessionId) return;
    // Lit when an OPEN channel goes away while a run is in flight: the only
    // state in which frames can have been missed. `wasOpen` is what separates
    // that from a dial: a send whose `connect()` opens a closed channel also
    // passes through `connecting`, and settling on that would delete the
    // optimistic turn of a prompt that is not even on the wire yet.
    let cancelled = false;

    const unsubscribe = realtimeClient.onStatus(() => {
      if (cancelled) return;
      if (realtimeClient.status() !== 'open') {
        // Either piece of evidence that a run is in flight: the stream named it,
        // or the server's `stream` row exists (which also covers a run whose
        // very first frame — `agent_start` — was the one lost).
        if (facts.wasOpen && facts.sawRun) {
          facts.missedFrames = true;
          // Recorded NOW: the probe below is a request, and a run that settles
          // while it is in flight would otherwise settle against a flag that
          // has not been written yet.
          onFramesLostRef.current();
        }
        facts.wasOpen = false;
        return;
      }
      facts.wasOpen = true;
      if (!facts.missedFrames) return;
      facts.missedFrames = false;
      // Deliberately NOT gated on `isGeneratingRef`: the flag can be false for a
      // run that is still live (or one that ended while the tab was away), and
      // the probe below is the authority on which it is.
      void (async () => {
        const probe = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`)
          .then((res) => (res.ok ? (res.json() as Promise<AgentRunProbe>) : null))
          .catch(() => null);
        // Re-checked at the answer, not only at the trigger: the user may have
        // switched sessions while the probe was in flight.
        if (cancelled) return;
        // Still live: nothing to settle, and the loss is already recorded.
        if (!runIsOver(probe)) return;
        facts.sawRun = false;
        onSettledRef.current();
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sessionId, isGeneratingRef, streamRunRef, serverRunRef]);
}
