/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The contract between the frame fold and the session wrapper it folds into.
 * Types only, split out to keep `frame-fold.ts` under the size ceiling.
 */

import type { AutoTitleHost } from '@/server/lib/omp/session/auto-title.server';
import type { QueueDeliveryHost } from '@/server/lib/queue/delivery.server';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { ModeMirror } from '@/server/lib/omp/rpc/mode-mirror';
import type { SessionRunModel } from '@/shared/lib/omp/session/stream-state.server';

/**
 * Wrapper surface the fold reads and writes. Every field is owned by the
 * wrapper; the fold mutates them in place exactly as the inline switch did.
 * Composes the two host contracts the settle path hands the wrapper to
 * (auto-title, queue delivery) so the wrapper itself satisfies this whole type.
 */
export interface SessionFrameHost extends AutoTitleHost, QueueDeliveryHost {
  promptRunning: boolean;
  streaming: boolean;
  compacting: boolean;
  /** Abort verdict of the current run — see `endedAborted` in `terminal-settle.ts`. */
  runAborted: boolean;
  /**
   * The provider failure the run's last settled assistant message carried, in
   * omp's own words (`errorMessage` / `errorStatus`).
   *
   * Captured at `message_end` for the same reason `runAborted` is: omp compacts
   * an oversized terminal frame by dropping the messages it already delivered,
   * so the reason a run failed is routinely absent from `agent_end.messages`.
   * Cleared by a later assistant message that did not fail — that is the proof
   * the run recovered.
   */
  runFailure: string | null;
  /** True between `auto_retry_start` and `auto_retry_end`. omp keeps the RUN
   *  open across a retry saga, so nothing may report an outcome while this is
   *  set. */
  retrySagaOpen: boolean;
  /** The reason the last retry saga closed with, when it closed as a failure
   *  (`Retry budget exhausted after 3 retries: …`). */
  retryFinalError: string | null;
  /** Set once this run has told its coordinator how it ended; cleared at
   *  `agent_start` so a queued follow-up run reports its own outcome. */
  runOutcomeReported: boolean;
  awaitingAgentStart: boolean;
  awaitingAgentStartDeadline: number;
  continuationGraceUntil: number;
  emit(event: AgentEvent): void;
  /** Remember a blocking ask/approval dialog so a reattaching client can answer it. */
  trackUiDialog(frame: AgentEvent): void;
  /** Mirror of omp's plan/goal mode, fed by the frames this fold sees. */
  modeMirror: ModeMirror;
  /**
   * The model the child is serving with, as the wrapper last reconciled it.
   * The `stream` row this fold writes carries it.
   */
  runModel: SessionRunModel | null;
  /** Fold a subagent frame into the liveness roster. */
  observeSubagent(frame: AgentEvent, now: number): void;
  /**
   * Re-read the model the child is actually serving with and rename the live run
   * row to match — omp's payload-less `model_changed`, e.g. a fallback-chain
   * retry that swapped the model mid-run.
   */
  syncRunModel(): void;
}

/** What the caller must do after the fold. */
export interface FrameFoldResult {
  /** The fold already handled this frame's user-visible effect and the caller
   *  must NOT forward it: a failed `prompt` response has emitted its own
   *  `prompt_error`, and a `command_output` belonging to Kabmo's own
   *  background rename must stay out of the timeline. */
  suppressForward: boolean;
}
