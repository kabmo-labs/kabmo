/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
   * Set the generating state. `owned` marks a run THIS PAGE dispatched; every
   * caller but the send path omits it, so an adopted run never claims ownership
   * (a session opened mid-run must not discard its own committed history).
   */
  setGenerating: (v: boolean, owned?: boolean) => void;
  /** Live activity phrase for the docked indicator (phase or tool call). */
  generatingVerb: string;
  setGeneratingVerb: (v: string) => void;
}

export function useGeneratingState(): GeneratingState {
  const [isGenerating, setIsGenerating] = useState(false);
  const isGeneratingRef = useRef(false);
  const ownRunRef = useRef(false);
  const [ownRun, setOwnRun] = useState(false);
  const [generatingVerb, setGeneratingVerb] = useState('');

  // Stable identity is load-bearing: this is a dependency of the session-load
  // effect, which re-fetches history and replaces the timeline. A fresh function
  // per render made that effect re-run every render, and its setLocalMessages
  // then re-rendered again — an unbounded fetch loop.
  const setGenerating = useCallback((v: boolean, owned = false) => {
    isGeneratingRef.current = v;
    if (!v) ownRunRef.current = false;
    else if (owned) ownRunRef.current = true;
    // Mirror onto state: `timelineRunning` is computed during render, so a
    // ref-only ownership flag could not reach the footer's withheld guard.
    setOwnRun(ownRunRef.current);
    setIsGenerating(v);
  }, []);

  return {
    isGenerating,
    isGeneratingRef,
    ownRun,
    ownRunRef,
    setGenerating,
    generatingVerb,
    setGeneratingVerb,
  };
}
