/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether the run a REATTACHED client was following is over.
 *
 * A socket that comes back after a run's terminal frames were lost with it
 * leaves the timeline holding the stream's last `message_update` — a partial
 * answer — and nothing else will ever finalize it: `message_end` and
 * `agent_end` were emitted into a socket nobody was reading. The snapshot that
 * repairs the attachment says only whether a run is live NOW, and that answer
 * has to be read precisely, because the SAME shape ("child alive, nothing
 * running") appears in the beat between a send's `connect()` and its prompt —
 * acting on it there would settle a run that is about to start.
 *
 * `busy` is deliberately NOT evidence either way: the server sets it for work a
 * probe would queue behind (a live subagent whose parent turn ended, a parked
 * dialog), and a session with something else live is left alone rather than
 * settled.
 *
 * The final word is omp's OWN verdict, `state.isSettled`, and it must be
 * literally `true`. The server's `RunSettle` applies exactly that rule
 * (`isSettled !== true` → do not settle), and two answers to "is this run over"
 * is how the indicator and the transcript end up disagreeing. A build that does
 * not report the field therefore settles nothing here — a reload costs one
 * reconnect, while settling a live run throws the streaming answer away.
 */

/** The `GET /api/agent/:id` / topic-snapshot payload, narrowed to what this
 *  decision reads. */
export interface AgentRunProbe {
  running?: boolean;
  busy?: boolean;
  state?: {
    isStreaming?: boolean;
    isPromptRunning?: boolean;
    /** omp's own quiescence verdict. Absent on builds that do not report it. */
    isSettled?: boolean;
    /** Follow-ups and steers omp has accepted but not run yet. A non-zero
     *  count means the session WILL wake again, so it is not finished — and it
     *  is what keeps this from settling a session whose queued prompt was
     *  delivered server-side while the tab was away. */
    queuedMessageCount?: number;
  } | null;
}

export function runIsOver(probe: AgentRunProbe | null | undefined): boolean {
  // No answer (a failed request, a refused payload) is not a verdict: leave the
  // timeline alone and let the next reconnect ask again.
  if (!probe) return false;
  if (probe.running === false) return true;
  if (probe.busy) return false;
  const state = probe.state;
  if (!state) return false;
  if (state.isStreaming || state.isPromptRunning) return false;
  if (typeof state.queuedMessageCount === 'number' && state.queuedMessageCount > 0) return false;
  // omp's own quiescence verdict, and the ONLY thing that may settle a run —
  // the same rule the server applies (`RunSettle`: `isSettled !== true` → do
  // not settle). Absent means the build does not report it, which is NOT
  // evidence of quiescence: a turn can be admitted but not yet streaming, and
  // settling there would reload the transcript mid-dispatch.
  return state.isSettled === true;
}
