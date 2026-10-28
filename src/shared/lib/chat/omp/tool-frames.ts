/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The three tool-execution frames, folded into the tool-result map.
 *
 * Split out of `agent-events.ts` (which is at the repo's per-file ceiling) as
 * one unit: the three frames share the map they write, the start clock that
 * ties them together, and the re-emit that pushes the change onto the card.
 * Reading them apart is what makes the sequence legible —
 * `tool_execution_start` opens the span, `tool_execution_update` streams the
 * snapshot (output AND details), `tool_execution_end` closes both.
 */

import type { ToolCallData } from '@/shared/types';
import { toolResultText } from '@/shared/lib/omp/session/mapper';
import { extractToolImages } from '@/shared/lib/omp/session/tool-images';
import { describeToolActivity } from '@/shared/lib/chat/timeline/tool-verbs';
import { PHASE_VERBS } from '@/shared/lib/chat/timeline/tool-phrases';
import { setActivity, toolHost, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/fold-deps';
import {
  putToolResult,
  refreshToolMessage,
  resultDetails,
  toolMessageFor,
} from '@/shared/lib/chat/omp/tool-results';

/** `tool_execution_start`: name the activity and open the call's clock. */
export function foldToolStart(data: Record<string, unknown>, deps: OmpAgentFoldDeps): void {
  const callId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
  setActivity(describeToolActivity({
    name: typeof data.toolName === 'string' ? data.toolName : undefined,
    args: data.args,
    intent: typeof data.intent === 'string' ? data.intent : undefined,
  }), deps);
  const startedAt = Date.now();
  if (callId) deps.toolResultsRef.current?.set(callId, { output: '', startedAt, pending: true });
  // `toolMessageFor` falls back to the transcript row, so a run resumed by a
  // page reload marks the card that is already on screen as running instead of
  // finding no target and leaving it at whatever the transcript said.
  const last = callId ? toolMessageFor(deps, callId) : deps.lastToolMessageRef.current;
  if (last?.toolCalls?.some(tc => tc.id === callId)) {
    deps.lastToolMessageRef.current = {
      ...last,
      toolCalls: last.toolCalls.map(tc => (
        tc.id === callId ? { ...tc, status: 'running' as ToolCallData['status'], startedAt } : tc
      )),
    };
    deps.callbacksRef.current?.onMessageUpdate?.(deps.lastToolMessageRef.current);
  }
}

/**
 * `tool_execution_update`: stream the call's output AND its progress details.
 *
 * `partialResult` is the tool's output SO FAR, not the fragment since the last
 * update — omp hands over a full snapshot on every frame (measured on 18.3.0
 * and 18.8.3: a bash loop echoing one line a second reports "L1", then
 * "L1\nL2", then "L1\nL2\nL3"). Appending those snapshots renders the running
 * card as interleaved text ("L1\nL1\nL2\nL1\nL2\nL3"), which is what a long
 * command looked like until its `tool_execution_end` overwrote the record.
 *
 * The DETAILS ride the same snapshot and are the only live progress a blocking
 * tool reports: `wait` re-emits `{op:'wait', jobs:[{status, durationMs,
 * completionPercent}]}` every 500 ms while it blocks (`PROGRESS_INTERVAL_MS`).
 * Dropping them left the card with no elapsed time and no running rows until
 * the call returned, so the wait panel could only ever describe a FINISHED
 * wait. The frame nests them under `partialResult`, so that is what is read.
 *
 * A frame carrying none keeps the record's previous details: the write
 * REPLACES the entry, so an absent bag would erase the last snapshot.
 */
export function foldToolUpdate(data: Record<string, unknown>, deps: OmpAgentFoldDeps): void {
  const callId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
  if (!callId) return;
  const partial = toolResultText(data.partialResult);
  const stored = deps.toolResultsRef.current?.get(callId);
  const details = resultDetails({ result: data.partialResult }) ?? stored?.details;
  putToolResult(deps, callId, {
    output: partial || stored?.output || '',
    ...(details ? { details } : {}),
    pending: true,
  });
  refreshToolMessage(callId, toolHost(deps));
}

/**
 * `tool_execution_end`: store the result and close the span.
 *
 * The span is measured here because omp reports none — the frame carries the
 * result and its `details`, never a duration — so a `wait` that blocked for
 * two minutes otherwise read exactly like one that returned instantly.
 */
export function foldToolEnd(data: Record<string, unknown>, deps: OmpAgentFoldDeps): void {
  const callId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
  if (!callId) return;
  setActivity(PHASE_VERBS.thinking, deps);
  const images = extractToolImages(data.result);
  const startedAt = deps.toolResultsRef.current?.get(callId)?.startedAt;
  putToolResult(deps, callId, {
    output: toolResultText(data.result),
    isError: data.isError === true,
    details: resultDetails(data),
    pending: false,
    ...(startedAt !== undefined ? { durationMs: Math.max(0, Date.now() - startedAt) } : {}),
    ...(images.length > 0 ? { images } : {}),
  });
  refreshToolMessage(callId, toolHost(deps));
}
