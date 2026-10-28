/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The deps record `foldAgentEvent` reads, plus the two small helpers that
 * narrow it. Split out of `agent-events.ts` so that file — which is already the
 * switch over every frame omp can send — stays under the repo's per-file size
 * ceiling.
 *
 * These are pure accessors over caller-owned state: no closure of their own, no
 * module state, so importing them from either side of the fold is free.
 */

import type { Dispatch, RefObject, SetStateAction } from 'preact/compat';
import type { ChatMessageData, OmpAgentCallbacks, OmpAgentState } from '@/shared/types';
import type { ToolResultHost, ToolResultRecord } from '@/shared/lib/chat/omp/tool-results';

export interface OmpAgentFoldDeps extends ToolResultHost {
  sessionId: string;
  setState: Dispatch<SetStateAction<OmpAgentState>>;
  callbacksRef: RefObject<OmpAgentCallbacks>;
  toolResultsRef: RefObject<Map<string, ToolResultRecord>>;
  lastToolMessageRef: RefObject<ChatMessageData>;
  /** Last activity phrase published to the indicator; guards per-token frames
   *  from re-setting identical state. */
  activityRef: RefObject<string>;
  /** Thinking level in effect for the live run (last `thinking_level_changed`
   *  frame); stamped onto assistant turns as they stream. */
  currentThinkingLevelRef: RefObject<string | undefined>;
  /** Phrase for an OPEN provider-retry saga, or null. Set and cleared by
   *  `provider-retry.ts`, which owns the saga's lifetime.
   *
   *  While it is set it outranks the activity the attempt itself names: a
   *  retried request spends ~10s inside a call that will fail, and the frames
   *  in that stretch are the doomed attempt's own (`turn_start` → "Thinking…"),
   *  so the honest phrase was replaced by the generic one a second after it
   *  appeared. Measured on a real quota wall: both samples of a live saga read
   *  "Thinking…", which is exactly the uninformative spinner this replaced. */
  providerRetryVerbRef: RefObject<string | null>;
}

/** Publish a new indicator phrase, skipping repeats (thinking/text deltas
 *  arrive per token and would otherwise re-set state on every frame).
 *
 *  An open provider-retry saga wins over whatever the frame names: see
 *  `providerRetryVerbRef`. That case publishes even when the mirror already
 *  holds the phrase, because the mirror and the indicator can disagree — the
 *  run-start callback writes the indicator directly ("Thinking…"), so the
 *  mirror reads "no change" while the screen has just lost the phrase the user
 *  needs. Measured on a real quota wall: the phrase held for ~3s and was gone
 *  by the next attempt. */
export function setActivity(verb: string | undefined, deps: OmpAgentFoldDeps): void {
  if (!verb) return;
  const retryVerb = deps.providerRetryVerbRef.current;
  if (retryVerb && retryVerb !== verb) {
    deps.activityRef.current = retryVerb;
    deps.callbacksRef.current?.onActivity?.(retryVerb);
    return;
  }
  if (verb === deps.activityRef.current) return;
  deps.activityRef.current = verb;
  deps.callbacksRef.current?.onActivity?.(verb);
}

/** Narrow a deps record to the tool-output host, adding the re-emit sink. */
export function toolHost(deps: OmpAgentFoldDeps): ToolResultHost {
  return { ...deps, onMessageUpdate: deps.callbacksRef.current?.onMessageUpdate };
}
