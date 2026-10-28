/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp's auto-retry lifecycle, as the timeline shows it.
 *
 * omp replays transient provider errors by itself (`retry.enabled`, up to
 * `retry.maxRetries` attempts, honoring the provider's own `retry-after`), and
 * it keeps the RUN open across those attempts: each retry announces itself with
 * `auto_retry_start` and opens a fresh `agent_start`, with no `agent_end` in
 * between. The Kabmo therefore renders a live run for the whole stall — the
 * sidebar spinner and the generating indicator are correct — while the timeline
 * shows only the failed turn and says nothing about why nothing is moving.
 * Measured on a real quota wall: ~2m43s of that, and the last visible row was
 * an error.
 *
 * This module is the missing half: the indicator names the wait and its
 * position in the budget, and the FIRST retry of a saga leaves one notice row in
 * the transcript so a chat reloaded afterwards still records what happened.
 * `attempt === 1` is what marks a saga: omp increments the counter per retry and
 * only resets it when the budget restarts (a model fallback), so every later
 * attempt would repeat the same row.
 */

import { setActivity, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/fold-deps';
import { PHASE_VERBS } from '@/shared/lib/chat/timeline/tool-phrases';
import type { ProviderRetryInfo } from '@/shared/types';

/** Longest provider message carried into a notice row. */
const MAX_REASON_CHARS = 240;

/** A wait as a reader thinks of it: `7s`, `1m`, `1m30s`. */
function formatWait(delayMs: number): string {
  const seconds = Math.max(1, Math.round(delayMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`;
}

/** Indicator phrase for the wait omp is taking. */
export function retryVerb(info: ProviderRetryInfo): string {
  const position =
    info.attempt === undefined
      ? ''
      : info.maxAttempts === undefined
        ? ` ${info.attempt}`
        : ` ${info.attempt}/${info.maxAttempts}`;
  const wait = info.delayMs === undefined ? '' : ` · next in ${formatWait(info.delayMs)}`;
  return `Retrying after a provider error${position}${wait}`;
}

/** The one-line record of a retry saga, for the transcript. */
export function retryNotice(info: ProviderRetryInfo): string {
  const budget = info.maxAttempts === undefined ? 'automatic retries' : `up to ${info.maxAttempts} attempts`;
  const reason = (info.errorMessage ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_CHARS);
  return `Provider error — omp is retrying (${budget}).${reason ? ` Original: ${reason}` : ''}`;
}

/** Read the retry numbers off a frame, ignoring anything of the wrong shape. */
function retryInfoFromFrame(frame: Record<string, unknown>): ProviderRetryInfo {
  const info: ProviderRetryInfo = {};
  if (typeof frame.attempt === 'number') info.attempt = frame.attempt;
  if (typeof frame.maxAttempts === 'number') info.maxAttempts = frame.maxAttempts;
  if (typeof frame.delayMs === 'number') info.delayMs = frame.delayMs;
  if (typeof frame.errorMessage === 'string') info.errorMessage = frame.errorMessage;
  return info;
}

/**
 * Fold omp's retry lifecycle frames (`auto_retry_start` / `auto_retry_end`) into
 * the indicator and the transcript.
 */
export function foldAutoRetry(frame: Record<string, unknown>, deps: OmpAgentFoldDeps): void {
  if (frame.type === 'auto_retry_end') {
    // The saga is over: omp answers again, or the budget is spent and the run is
    // about to end.
    endRetrySaga(deps);
    return;
  }
  const info = retryInfoFromFrame(frame);
  const verb = retryVerb(info);
  // Set before publishing: the ref is what keeps the phrase on screen through
  // the attempt's own frames, which name a phase ("Thinking…") rather than a
  // retry — see `providerRetryVerbRef` in `fold-deps.ts`.
  deps.providerRetryVerbRef.current = verb;
  setActivity(verb, deps);
  if (info.attempt === 1) deps.callbacksRef.current?.onProviderRetry?.(info);
}

/**
 * Close an open retry saga, if any. Called by the retry lifecycle itself and by
 * the frames that end a run — a terminal `agent_end` or a prompt error can
 * arrive with no `auto_retry_end` in front of it, and a stale phrase would then
 * describe a wait that is over.
 */
export function endRetrySaga(deps: OmpAgentFoldDeps): void {
  if (deps.providerRetryVerbRef.current === null) return;
  deps.providerRetryVerbRef.current = null;
  setActivity(PHASE_VERBS.thinking, deps);
}
