/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer's Plan/Goal mode state.
 *
 * ## Why per session, not global
 *
 * The access mode is a GLOBAL preference (`useChatTimelineAccessMode`): it
 * describes how the user wants tools approved, and they want the same answer
 * everywhere. Plan and Goal mode are the opposite — they describe what THIS
 * conversation is doing. A global toggle would put every other open chat into
 * plan mode as a side effect, and two tabs on two sessions would fight.
 *
 * ## Where the truth lives
 *
 * The child process is authoritative: omp owns both modes, and every transition
 * it makes arrives as a `goal_updated` frame or a `*_STATE` marker from
 * Kabmo's own extension. The client mirrors that and sends intents. A
 * reload re-reads the mirror from the session's JSONL
 * (`GET /api/sessions/:id/modes`), so a chat reopened in another tab shows the
 * modes it is actually in rather than the last thing this tab requested.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  EMPTY_MODE_SELECTION,
  type KabmoModeSelection,
  type GoalContinuation,
  type GoalRecord,
} from '@/shared/lib/omp/mode/types';
import { goalMarkerPatch, useModeMarkers, type ModesResponse } from '@/client/hooks/chat/timeline/mode-markers';
import { createGoalAction } from '@/client/hooks/chat/timeline/goal-command';
import { isGoalOpen } from '@/shared/lib/omp/mode/status';
import { isPendingSessionId } from '@/shared/lib/omp/session/default-title';
import { isModeMarker } from '@/shared/lib/omp/mode/constants';

export interface ChatTimelineModes {
  plan: boolean;
  /** omp's own `enabled` flag: the agent is working toward the goal right now.
   *  False for a PAUSED goal, which still exists (see `goalOpen`). */
  goal: boolean;
  /** A goal this chat still owns — omp's `enabled` OR an open record. This is
   *  the flag every surface should gate on: pausing clears `enabled` while the
   *  record stays resumable, so gating on `goal` alone made the goal vanish
   *  from the composer (strip gone, button off, modal offering to create a
   *  second goal over the paused one). */
  goalOpen: boolean;
  goalRecord: GoalRecord | null;
  /**
   * The child's last automatic goal turn (`KABMO_GOAL_CONTINUATION`), or
   * null when the loop has not reported one for the current goal. Cleared when
   * the goal itself changes: a counter from the previous goal names a turn this
   * one never took.
   */
  goalContinuation: GoalContinuation | null;
  /**
   * True while the child's loop is deciding whether to open another automatic
   * turn. The decision is a synchronous guard chain with no other frame, so
   * this is the only signal for the window in which the goal is neither
   * streaming nor idle.
   */
  goalEvaluating: boolean;
  /** True while a mode command is in flight; the toggle shows a pending state
   *  rather than flipping optimistically and snapping back. */
  pending: boolean;
  /** omp refuses to enter one mode while the other is active, so Plan is not
   *  offered while Goal is on — a button whose only outcome is a refusal is
   *  worse than an absent one. The child enforces the same rule, because this
   *  flag only hides a button: a stale client or a typed `/plan` used to reach
   *  the child and turn both modes on. */
  planAvailable: boolean;
  /**
   * The last refusal, from either side of the wire: the route's own error, or a
   * `KABMO_MODE_ERROR` the extension emitted (an unknown action, a missing
   * omp API, the plan/goal exclusion). Surfaced by the composer because a mode
   * command that fails silently leaves the toggle pressed over a mode the child
   * is not in.
   */
  error: string | null;
  /** Clear the refusal once it has been shown. */
  clearError: () => void;
  /**
   * For a pending `new-…` chat only: the selection its spawn must carry, since
   * there is no child to command yet. Null once the session exists — from then
   * on the child is authoritative and the value is written to its transcript.
   *
   * A ref rather than a value because the reader is the SEND path
   * (`executeSend`), which runs outside the render that produced it.
   */
  spawnSelectionRef: { current: KabmoModeSelection | null };
  onTogglePlan: (enabled: boolean) => void;
  /** Goal needs an objective, so the toggle opens a modal instead of sending a
   *  bare enable — see `GoalModal`. */
  onGoalAction: (action: GoalAction) => void;
}

export type GoalAction =
  | { kind: 'create'; objective: string; tokenBudget?: number; maxTurns?: number }
  | { kind: 'guided'; rough: string }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'drop' }
  | { kind: 'budget'; value: number | 'off' };

export function useChatTimelineModes(sessionId: string | null): ChatTimelineModes {
  // A pending `new-…` chat has no omp session to command: `/api/agent/:id`
  // answers 404 and nothing persists. The selection lives in
  // `spawnSelectionRef` instead, and the SEND path hands it to the spawn
  // (`executeSend` → `sendNewPrompt` → the session's `KABMO_MODES`
  // environment), which is the earliest moment a child exists to carry it.
  const [plan, setPlanState] = useState(false);
  const [goal, setGoalState] = useState(false);
  const [goalRecord, setGoalRecord] = useState<GoalRecord | null>(null);
  const [goalContinuation, setGoalContinuation] = useState<GoalContinuation | null>(null);
  /** True while the child's loop is deciding (marker-driven, see
   *  `KABMO_GOAL_EVALUATING_MARKER`). */
  const [goalEvaluating, setGoalEvaluating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  // The mode the toggles currently READ, for the rollback below: the previous
  // value is needed outside a state updater (React may run one twice).
  const planRef = useRef(false);
  planRef.current = plan;
  /** The selection a pending chat's spawn must carry. Reset whenever the hook
   *  is looking at a real session — from then on the child owns the modes. */
  const spawnSelectionRef = useRef<KabmoModeSelection | null>(null);
  // Mirrors the record's id so a goal transition can be detected OUTSIDE a
  // state updater. Comparing inside `setGoalRecord` would put the reset in an
  // updater that React may run twice.
  const goalIdRef = useRef<string | null>(null);

  // Hydrate from the session's own record. A fresh session answers the empty
  // selection, so a brand-new chat renders both toggles off without a request
  // having to distinguish "unknown" from "off".
  //
  // The reset happens BEFORE the read, not only from its answer: a session whose
  // record cannot be read at all (a pending `new-…` chat, a deleted session —
  // the route answers 404) would otherwise keep the PREVIOUS session's modes,
  // and the composer would show another chat's goal banner and a pressed Goal
  // button. Measured: switching to a pending chat rendered the last session's
  // objective in the goal strip.
  useEffect(() => {
    const current = sessionId;
    setPlanState(false);
    setGoalState(false);
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
        setPlanState(data.modes.plan === true);
        setGoalState(data.modes.goal === true);
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
  }, [sessionId]);

  // Live transitions. omp's own `goal_updated` and the extension's markers both
  // arrive through this one channel, so the toggles follow the CHILD — including
  // a goal the model created itself during a guided interview, and one paused
  // by an interrupt.
  useModeMarkers(sessionId, (marker) => {
    const patch = goalMarkerPatch(marker, goalIdRef.current);
    if (patch) {
      // A different goal owns a different turn count — including no goal at all
      // (Drop reports `goal: null`), which must not leave the last counter
      // standing.
      if (patch.goalChanged) {
        goalIdRef.current = patch.record?.id ?? null;
        setGoalContinuation(null);
      }
      if (patch.continuation !== undefined) setGoalContinuation(patch.continuation);
      if (patch.evaluating !== undefined) setGoalEvaluating(patch.evaluating);
      // A state frame carries the record; the evaluating/continuation frames
      // carry none, so they must not blank it.
      if (isModeMarker(marker.marker, 'goalStateMarker')) {
        setGoalRecord(patch.record);
        setGoalState(patch.enabled);
        if (!patch.record || patch.record.status !== 'active') setGoalEvaluating(false);
      }
      return;
    }
    if (isModeMarker(marker.marker, 'planStateMarker')) {
      setPlanState(marker.payload.enabled === true);
      return;
    }
    if (isModeMarker(marker.marker, 'modeErrorMarker')) {
      setError(typeof marker.payload.reason === 'string' ? marker.payload.reason : 'Mode command failed');
      // A refusal means the mode did NOT change, so the optimistic flip has to
      // come back off. The scope tag is what says which toggle lied; without it
      // a refused `plan on` under a live goal left the button pressed over a
      // mode the child never entered (measured).
      if (marker.payload.scope === 'plan') setPlanState(false);
    }
  });

  const send = useCallback(
    async (scope: 'plan' | 'goal', action: string, payload?: Record<string, unknown>) => {
      const sessionId = sessionRef.current;
      if (!sessionId) return false;
      setPending(true);
      setError(null);
      try {
        const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'kabmo_mode', scope, action, ...(payload ? { payload } : {}) }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? 'Mode command failed');
          return false;
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Mode command failed');
        return false;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const onTogglePlan = useCallback(
    (enabled: boolean) => {
      // A pending chat: keep the pick for the spawn instead of POSTing to a
      // session that does not exist. The optimistic flip is not a guess here —
      // it IS the state, because the spawn will read it back from this ref.
      setError(null);
      if (isPendingSessionId(sessionRef.current)) {
        setPlanState(enabled);
        spawnSelectionRef.current = { plan: enabled, goal: false };
        return;
      }
      const previous = planRef.current;
      // The child answers with a marker that re-sets this; the optimistic flip
      // exists only so the button responds to the press. A REFUSED command
      // rolls it back: leaving it pressed over a mode the child is not in is
      // the lie the refusal exists to prevent (measured: `plan on` against a
      // live goal returned 200, the child refused, and the button stayed on).
      setPlanState(enabled);
      void send('plan', enabled ? 'on' : 'off').then((ok) => {
        if (!ok) setPlanState(previous);
      });
    },
    [send],
  );

  const runGoalAction = useMemo(
    () => createGoalAction({
      send: (scope, action, payload) => send(scope, action, payload),
      setGoalState,
      setGoalRecord,
      setGoalContinuation,
    }),
    [send],
  );

  const onGoalAction = useCallback(
    (action: GoalAction) => {
      // A pending chat has no child to create a goal on, and the spawn env
      // cannot carry one: a goal needs an objective and an opening turn, and
      // `restoreModes` deliberately does NOT resume a restored goal. Refused
      // with a reason rather than queued silently — the modal closes on submit,
      // so a silent drop would look like the goal was created.
      if (isPendingSessionId(sessionRef.current)) {
        setError('Send a message first — a goal needs a session to run in.');
        return;
      }
      runGoalAction(action);
    },
    [runGoalAction],
  );

  const clearError = useCallback(() => setError(null), []);

  // omp's own mutual exclusion (`#enterGoalMode` refuses while plan mode is
  // active and vice versa), surfaced as an availability rule rather than as a
  // refusal the user has to read — and enforced in the child for the callers
  // this flag cannot reach (a stale client, a typed `/plan`).
  return {
    plan,
    goal,
    goalOpen: goal || Boolean(goalRecord && isGoalOpen(goalRecord.status)),
    goalRecord,
    goalContinuation,
    goalEvaluating,
    pending,
    planAvailable: !goal,
    error,
    clearError,
    spawnSelectionRef,
    onTogglePlan,
    onGoalAction,
  };
}

export { EMPTY_MODE_SELECTION };
