/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp's retry lifecycle, as the SERVER tracks it.
 *
 * omp retries a transient provider failure by itself and keeps the RUN open
 * across the attempts: each attempt announces `auto_retry_start` and opens a
 * fresh `agent_start`, with no terminal `agent_end` in between, and the saga
 * closes with `auto_retry_end` — carrying `finalError` when the budget ran out.
 *
 * That shape is what a coordinator must not be told about per attempt: the
 * outcome of a delegated child is reported at its TERMINAL end, and a report
 * per attempt said "failed" while omp was still working, which is what made a
 * coordinator resend the task. The two flags below are the fold's half:
 * `retrySagaOpen` says the run is not over, `retryFinalError` says why it
 * ended once it is.
 *
 * The client folds the same frames for the indicator and the transcript notice
 * (`shared/lib/chat/timeline/provider-retry.ts`); this module is the server's,
 * and the two read one wire format.
 */

export interface RetrySagaHost {
  /** True between `auto_retry_start` and `auto_retry_end`. */
  retrySagaOpen: boolean;
  /** The reason the last saga closed with, when it closed as a failure. */
  retryFinalError: string | null;
}

/** Fold one retry frame. Returns false for any other frame type. */
export function noteRetryFrame(host: RetrySagaHost, event: Record<string, unknown>): boolean {
  if (event.type === 'auto_retry_start') {
    host.retrySagaOpen = true;
    // A new saga has no verdict yet; the previous run's reason must not leak
    // into this one.
    host.retryFinalError = null;
    return true;
  }
  if (event.type === 'auto_retry_end') {
    // Either an attempt succeeded — the run continues, and its own terminal
    // frame decides the outcome — or the budget is spent and the run is about
    // to end, and then THIS is the reason it did.
    host.retrySagaOpen = false;
    host.retryFinalError =
      event.success === false && typeof event.finalError === 'string' && event.finalError.trim()
        ? event.finalError.trim()
        : null;
    return true;
  }
  return false;
}
