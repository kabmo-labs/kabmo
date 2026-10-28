/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat's "a run is in flight" state: the local generating flag, the run
 * OWNERSHIP flag, and the activity verb. Extracted from `useChatTimeline` so
 * that hook stays under the repo's per-file size ceiling.
 *
 * Two flags, and the difference between them is the whole point:
 *
 * - `isGenerating` — this page is showing a run's live UI. Set by the send path
 *   AND by the mount probe that resumes a live run, so it is NOT ownership.
 * - `ownRun` — this page DISPATCHED the run. Armed only by a send
 *   (`setGenerating(true, true)`), released by every settle. It is what
 *   `timelineRunning` adds to the server's `stream` row: the row reaches this
 *   client a beat after the optimistic rows are armed, and for that beat the run
 *   would otherwise read as already settled — which painted the run footer over
 *   the empty placeholder row (see `useChatTimeline`'s `timelineRunning`).
 *
 * `ownRun` is render-visible state rather than a ref because `timelineRunning`
 * is computed during render; `ownRunRef` mirrors it for the non-reactive
 * session-load guard, which must not re-run its fetch effect on every arm.
 */

import { useCallback, useRef, useState } from 'preact/hooks';

export interface GeneratingState {
  /** This page is rendering a run's live UI (owned or merely adopted). */
  isGenerating: boolean;
  /** Non-reactive mirror of `isGenerating` for effect guards. */
  isGeneratingRef: { current: boolean };
  /** This page DISPATCHED the run in flight. Render-visible. */
  ownRun: boolean;
  /** Non-reactive mirror of `ownRun` for the session-load guard. */
  ownRunRef: { current: boolean };
  /**
   * The STREAM has spoken for the run in flight — an `agent_start` or a resume
   * of a live run, both of which call `setGenerating(true)` without ownership.
   * False for a run this page merely DISPATCHED and whose first frame has not
   * arrived, which is what keeps a reconnect in that window from settling a
   * turn that has not started.
   */
  streamRunRef: { current: boolean };
  /**
   * Set the generating state. `owned` marks a run THIS PAGE dispatched; every
   * caller but the send path omits it, so an adopted run never claims ownership
   * (a session opened mid-run must not discard its own committed history).
   */
  setGenerating: (v: boolean, owned?: boolean) => void;
  /** Live activity phrase for the docked indicator (phase or tool call). */
  generatingVerb: string;
  /**
   * Non-reactive mirror of `generatingVerb` — and the SAME ref the fold
   * dedupes against (`OmpAgentFoldDeps.activityRef`).
   *
   * One mirror, not two. When the screen and the dedupe key were separate
   * values, a writer that only set the screen (the resume path) made them
   * disagree: every later frame carrying the phrase the fold already had was
   * dropped as a repeat, and the indicator stayed on the stale phrase for the
   * rest of the run. Writing through `setGeneratingVerb` updates both, so the
   * two cannot drift.
   *
   * A session switch clears this ref alone (`useOmpAgent`), without touching
   * the rendered phrase — the same thing the old private ref did. That is
   * deliberate: the reset exists so the new session's first frame is not
   * deduped against the old session's last phrase, and the indicator is hidden
   * or about to be replaced at that moment. An empty ref therefore means "no
   * phrase has been published for this session yet", which is what the resume
   * guard needs.
   */
  activityRef: { current: string };
  setGeneratingVerb: (v: string) => void;
}

export function useGeneratingState(): GeneratingState {
  const [isGenerating, setIsGenerating] = useState(false);
  const isGeneratingRef = useRef(false);
  const ownRunRef = useRef(false);
  const streamRunRef = useRef(false);
  const [ownRun, setOwnRun] = useState(false);
  const [generatingVerb, setGeneratingVerbState] = useState('');
  const activityRef = useRef('');

  // Stable identity is load-bearing: this is a dependency of the session-load
  // effect, which re-fetches history and replaces the timeline. A fresh function
  // per render made that effect re-run every render, and its setLocalMessages
  // then re-rendered again — an unbounded fetch loop.
  const setGenerating = useCallback((v: boolean, owned = false) => {
    isGeneratingRef.current = v;
    if (!v) {
      ownRunRef.current = false;
      streamRunRef.current = false;
    } else {
      if (owned) ownRunRef.current = true;
      // Not owned: the stream itself announced this run (`agent_start`, or the
      // mount probe resuming a live one).
      else streamRunRef.current = true;
    }
    // Mirror onto state: `timelineRunning` is computed during render, so a
    // ref-only ownership flag could not reach the footer's withheld guard.
    setOwnRun(ownRunRef.current);
    setIsGenerating(v);
  }, []);

  const setGeneratingVerb = useCallback((v: string) => {
    activityRef.current = v;
    setGeneratingVerbState(v);
  }, []);

  return {
    isGenerating,
    isGeneratingRef,
    ownRun,
    ownRunRef,
    streamRunRef,
    setGenerating,
    generatingVerb,
    activityRef,
    setGeneratingVerb,
  };
}
