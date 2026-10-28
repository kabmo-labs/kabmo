/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The marker half of the composer's mode state: subscription, the hydration
 * shape, and the fold from one mode notice into the fields it moves.
 *
 * Split from `modes.ts` because that hook owns the COMMANDS (send, toggle,
 * spawn selection) and this half is pure translation — one marker in, one
 * patch out. Keeping them together pushed the file past the repo's ceiling, and
 * the seam is real: nothing here knows what a toggle is.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { KabmoModeSelection, GoalContinuation, GoalRecord } from '@/shared/lib/omp/mode/types';
import { KABMO_MODE_SIGNAL } from '@/shared/lib/omp/mode/client-signal';
import { isModeMarker } from '@/shared/lib/omp/mode/constants';
import { subscribeClientSignal } from '@/client/lib/signals';
import {
  continuationFromMarker,
  goalEnabledFromMarker,
  goalRecordFromMarker,
  type ParsedMarker,
} from '@/shared/lib/omp/mode/markers';

/** The persisted selection, plus the goal record the same read returns. */
export interface ModesResponse {
  modes?: KabmoModeSelection & { goalRecord?: GoalRecord | null; goalContinuation?: GoalContinuation | null };
}

/**
 * Subscribe to this session's mode markers. A marker for another session is
 * ignored: two chats can be open at once and only one of them owns the process
 * that emitted it.
 */
export function useModeMarkers(sessionId: string | null, handler: (marker: ParsedMarker) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => subscribeClientSignal(KABMO_MODE_SIGNAL, (detail) => {
    const marker = detail?.marker as ParsedMarker | undefined;
    if (!marker) return;
    if (sessionId && detail.sessionId && detail.sessionId !== sessionId) return;
    handlerRef.current(marker);
  }), [sessionId]);
}

/** What one goal marker moves. `null` when the marker is not a goal frame. */
export interface GoalMarkerPatch {
  record: GoalRecord | null;
  /** omp's own `enabled`: the agent is working toward the goal right now. */
  enabled: boolean;
  /** A goal id change, so the caller can drop a counter from the previous goal. */
  goalChanged: boolean;
  /** A verdict the child reported; `undefined` when this frame carried none. */
  continuation?: GoalContinuation | null;
  /** Only `KABMO_GOAL_EVALUATING` carries this. */
  evaluating?: boolean;
}

/**
 * Fold one marker into the goal fields it moves, or null when it is not a goal
 * frame.
 *
 * `currentGoalId` is the caller's mirror of the record's id. It has to be read
 * OUTSIDE a state updater (React may run one twice), which is why the caller
 * keeps it in a ref and passes it here rather than this module owning it.
 */
export function goalMarkerPatch(marker: ParsedMarker, currentGoalId: string | null): GoalMarkerPatch | null {
  if (isModeMarker(marker.marker, 'goalEvaluatingMarker')) {
    // The child's loop is deciding whether to open another turn. It has no
    // other frame (the decision is a synchronous guard chain), so this is what
    // the strip's spinner hangs off.
    return { record: null, enabled: false, goalChanged: false, evaluating: marker.payload.evaluating === true };
  }
  if (isModeMarker(marker.marker, 'goalContinuationMarker')) {
    // The loop's own per-turn report: emitted just before it opens an
    // automatic turn, so the run that follows is the turn it names. The
    // decision that produced it is over, so `evaluating` must not be left
    // standing (a lost `evaluating: false` would spin the strip forever).
    return {
      record: null,
      enabled: false,
      goalChanged: false,
      continuation: continuationFromMarker(marker.payload),
      evaluating: false,
    };
  }
  if (!isModeMarker(marker.marker, 'goalStateMarker')) return null;
  const record = goalRecordFromMarker(marker.payload);
  return {
    record,
    enabled: goalEnabledFromMarker(marker.payload),
    goalChanged: (record?.id ?? null) !== currentGoalId,
    // Only an entry that CARRIES the key speaks about the loop: most are goal
    // transitions with no verdict to report, and reading their absence as "no
    // verdict" would erase the last one on every token update.
    ...('continuation' in marker.payload
      ? { continuation: continuationFromMarker(marker.payload.continuation) }
      : {}),
  };
}
