/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's mode HYDRATE: what a chat's own record says its modes are.
 *
 * Split from `modes.ts` for the per-file ceiling; the rule is the part that
 * matters. A fresh session answers the empty selection, so a brand-new chat
 * renders both toggles off without a request having to distinguish "unknown"
 * from "off" — and the RESET happens before the read, not only from its answer:
 * a session whose record cannot be read at all (a pending `new-…` chat, a
 * deleted session — the route answers 404) would otherwise keep the PREVIOUS
 * session's modes, and the composer would show another chat's goal banner and a
 * pressed Goal button. Measured: switching to a pending chat rendered the last
 * session's objective in the goal strip.
 */

import { useEffect } from 'preact/hooks';
import { isPendingSessionId } from '@/shared/lib/omp/session/default-title';
import type { ModesResponse } from '@/client/hooks/chat/timeline/mode-markers';
import type { SessionModeState } from '@/shared/lib/harness/session-modes';
import type { GoalContinuation, GoalRecord, KabmoModeSelection } from '@/shared/lib/omp/mode/types';

export interface ModesHydrationTarget {
  sessionId: string | null;
  /** The pending chat's spawn selection, spent once a real session answers. */
  spawnSelectionRef: { current: KabmoModeSelection | null };
  /** Mirrors the record's id so a marker can tell a new goal from the same one. */
  goalIdRef: { current: string | null };
  setPlan: (value: boolean) => void;
  setMode: (value: SessionModeState | null) => void;
  setGoal: (value: boolean) => void;
  setGoalRecord: (value: GoalRecord | null) => void;
  setGoalContinuation: (value: GoalContinuation | null) => void;
  setGoalEvaluating: (value: boolean) => void;
}

export function useSessionModesHydration({
  sessionId,
  spawnSelectionRef,
  goalIdRef,
  setPlan,
  setMode,
  setGoal,
  setGoalRecord,
  setGoalContinuation,
  setGoalEvaluating,
}: ModesHydrationTarget): void {
  useEffect(() => {
    const current = sessionId;
    setPlan(false);
    setMode(null);
    setGoal(false);
    setGoalRecord(null);
    setGoalContinuation(null);
    setGoalEvaluating(false);
    goalIdRef.current = null;
    // The pending selection is spent at the spawn that adopts a real id: this
    // hook is now rendering the CHILD's modes, and a stale ref would re-apply
    // the pending chat's picks to an unrelated later spawn.
    if (!isPendingSessionId(current)) spawnSelectionRef.current = null;
    if (!current) return;
    // A pending `new-…` id has no session file, so the route can only answer
    // 404. Skipped rather than fetched-and-ignored: the read is what a network
    // panel shows, and a request whose only possible outcome is a 404 is noise.
    if (isPendingSessionId(current)) return;
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(current)}/modes`)
      .then((res) => (res.ok ? (res.json() as Promise<ModesResponse>) : null))
      .then((data) => {
        if (cancelled || !data?.modes) return;
        setPlan(data.modes.plan === true);
        setMode(data.modes.mode ?? null);
        setGoal(data.modes.goal === true);
        setGoalRecord(data.modes.goalRecord ?? null);
        // The loop's last verdict rides the same record, so a reload shows
        // "stopped at N turns" (and its Resume) instead of an active-looking
        // goal the child has already given up on. A verdict never reported is
        // null: the child's own counter cannot be reconstructed from a file.
        setGoalContinuation(data.modes.goalContinuation ?? null);
        goalIdRef.current = data.modes.goalRecord?.id ?? null;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // The setters are `useState` setters (stable) and the two refs are refs;
    // `sessionId` is the only thing whose change starts a new read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
}
