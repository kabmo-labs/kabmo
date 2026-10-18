/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The run-boundary half of the chat's omp callbacks: the points at which a run
 * opens or is reattached.
 *
 * Nothing here signals the sidebar. A run in flight has ONE source — the
 * server's `session_stream_state` row, published on the `sidebar:status` topic
 * and written at prompt dispatch — so the sidebar spinner and the timeline's
 * generating indicator read the same answer. A client-side mark was a second
 * one, and its release depended on the client naming the session id it had
 * armed, which is how a spinner outlived its run.
 *
 * Split from `omp-callbacks.ts` to keep that file under the repo's per-file
 * size ceiling; the closures take the caller's deps record, so the captured
 * semantics are unchanged.
 */

import type { OmpAgentCallbacksDeps } from '@/shared/lib/chat/timeline/omp-callbacks';
import { PHASE_VERBS } from '@/shared/lib/chat/timeline/tool-phrases';

/** A run STARTED: resume the generating UI and refresh the session metadata. */
export function handleAgentStart(deps: OmpAgentCallbacksDeps): void {
  const { setGenerating, setGeneratingVerb, scrollToBottom, adoptedSessionIdRef, sessionIdRef, metaRefreshedRef, refreshSessionMeta } = deps;
  setGenerating(true);
  setGeneratingVerb(PHASE_VERBS.thinking);
  setTimeout(() => scrollToBottom('smooth'), 50);
  const sid = adoptedSessionIdRef.current ?? sessionIdRef.current;
  if (!sid) return;
  if (metaRefreshedRef.current !== sid) {
    metaRefreshedRef.current = sid;
    setTimeout(() => refreshSessionMeta(sid), 100);
  }
}

/** Every turn inside the run. The sidebar is not signalled: it follows the
 *  `sidebar:status` topic, which the server publishes on the same status write
 *  this used to recover by re-reading. */
export function handleTurnStart(_deps: OmpAgentCallbacksDeps): void {
  // Nothing to do — kept as the callbacks' named boundary.
}

/**
 * Reload recovery: the omp process kept running server-side, so the event
 * stream is reattached and the generating UI must resume (the timeline fetch
 * already loaded the committed messages; live updates continue).
 *
 * The phrase is only NAMED when nothing is named yet. A reattach knows one
 * thing — a run is live — and nothing about what the run is doing, so writing
 * `Thinking` unconditionally overwrote a phrase a frame had already published.
 * That is not a cosmetic flicker, because the phrase has a SECOND mirror: the
 * fold dedupes against `activityRef`, which this write never touched. The two
 * then disagree, every later frame carrying the same phrase is dropped as a
 * repeat, and the indicator stays on `Thinking…` for the whole tool call.
 * Measured on a cold spawn: the tool's phrase appeared at t+45 and the spawn
 * path's topic republish called this at t+72 — 27 ms later — after which the
 * phrase never returned for the remaining 4.5 s of the call.
 *
 * A real reload has no phrase yet (`activityRef` and the screen are both
 * empty), so this still names the wait there.
 */
export function handleResumeStream(deps: OmpAgentCallbacksDeps): void {
  const { setGenerating, setGeneratingVerb, activityRef, scrollToBottom } = deps;
  setGenerating(true);
  if (!activityRef.current) setGeneratingVerb(PHASE_VERBS.thinking);
  setTimeout(() => scrollToBottom('smooth'), 50);
  // No sidebar signal: the run is live server-side, so its `stream` row is in
  // the status payload and the sidebar's spinner (and this indicator, through
  // `timelineRunning`) already report it.
}
