/**
 * @license
 * SPDX-License-Identifier: MIT
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
import { createGoalAction, type GoalActionResult } from '@/client/hooks/chat/timeline/goal-command';
import { postModeCommand, postSessionMode } from '@/client/hooks/chat/timeline/mode-post';
import { subscribeClientSignal } from '@/client/lib/signals';
import type { SessionModeState } from '@/shared/lib/harness/session-modes';
import { isGoalOpen } from '@/shared/lib/omp/mode/status';
import { isPendingSessionId } from '@/shared/lib/omp/session/default-title';
import { isModeMarker } from '@/shared/lib/omp/mode/constants';
import type { ArmedGoal, GoalAction } from '@/shared/lib/omp/mode/actions';
import { modeAvailability, type ModeCapabilities } from '@/client/hooks/chat/timeline/mode-availability';
import { usePendingSessionMode } from '@/client/hooks/chat/timeline/pending-session-mode';
import { useSessionModesHydration } from '@/client/hooks/chat/timeline/modes-hydrate';

import type { ChatTimelineModes } from '@/client/hooks/chat/timeline/modes-contract';

export type { ChatTimelineModes };
export type { ArmedGoal, GoalAction };
export type { ModeCapabilities };

export function useChatTimelineModes(
  sessionId: string | null,
  capabilities: ModeCapabilities = {},
): ChatTimelineModes {
  // A pending `new-…` chat has no omp session to command: `/api/agent/:id`
  // answers 404 and nothing persists. Plan's selection lives in
  // `spawnSelectionRef` instead, and the SEND path hands it to the spawn
  // (`executeSend` → `sendNewPrompt` → the session's `KABMO_MODES`
  // environment), which is the earliest moment a child exists to carry it.
  //
  // A GOAL uses the same seam for its own half: the objective is ARMED in
  // `goalArmRef` and created by the fence of the next prompt (see the header).
  const [goalArm, setGoalArm] = useState<ArmedGoal | null>(null);
  const goalArmRef = useRef<ArmedGoal | null>(null);
  goalArmRef.current = goalArm;
  const [plan, setPlanState] = useState(false);
  /** The agent's own mode selector (ACP), or null for omp and agents without one. */
  const [sessionMode, setSessionMode] = useState<SessionModeState | null>(null);
  const sessionModeRef = useRef<SessionModeState | null>(null);
  sessionModeRef.current = sessionMode;
  // The ladder and the pick for a chat that has not spawned yet, from its
  // harness probe — see `pending-session-mode.ts`.
  const pendingSession = usePendingSessionMode(sessionId, capabilities);
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

  // Hydrate from the session's own record; the reset-before-read rule lives in
  // `modes-hydrate.ts`.
  useSessionModesHydration({
    sessionId,
    spawnSelectionRef,
    goalIdRef,
    setPlan: setPlanState,
    setMode: setSessionMode,
    setGoal: setGoalState,
    setGoalRecord,
    setGoalContinuation,
    setGoalEvaluating,
  });

  // An agent can move its own mode/config (`mode_changed`/`config_changed`).
  // The frame carries no full list, so re-read the authoritative selector.
  useEffect(() => subscribeClientSignal('session-modes-changed', (payload) => {
    if (!sessionId || payload.sessionId !== sessionId || isPendingSessionId(sessionId)) return;
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/modes`)
      .then((res) => (res.ok ? (res.json() as Promise<ModesResponse>) : null))
      .then((data) => {
        if (data?.modes) setSessionMode(data.modes.mode ?? null);
      })
      .catch(() => {});
  }), [sessionId]);

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
      if (!sessionId) return { ok: false, error: 'No session to command.' };
      setPending(true);
      setError(null);
      try {
        const posted = await postModeCommand(sessionId, scope, action, payload);
        if (!posted.ok) setError(posted.error ?? 'Mode command failed');
        return posted;
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
      void send('plan', enabled ? 'on' : 'off').then((result) => {
        if (!result.ok) setPlanState(previous);
      });
    },
    [send],
  );

  const onSelectSessionMode = useCallback(async (value: string) => {
    const current = sessionModeRef.current;
    const session = sessionRef.current;
    if (!session) return;
    // A pending chat has no child: the pick is held for the spawn, the same seam
    // the model and harness picks use. POSTing it answered 404 and dropped the
    // click, which is why the control read as inert before the first prompt.
    if (isPendingSessionId(session)) {
      pendingSession.select(value);
      setPlanState(value === 'plan');
      setError(null);
      return;
    }
    if (!current || current.currentValue === value) return;
    setSessionMode({ ...current, currentValue: value });
    setPlanState(value === 'plan');
    setPending(true);
    setError(null);
    const result = await postSessionMode(session, value);
    setPending(false);
    if (!result.ok) {
      setSessionMode(current);
      setPlanState(current.currentValue === 'plan');
      setError(result.error ?? 'Mode change failed');
    }
  }, [pendingSession.select]);

  const runGoalAction = useMemo(
    () => createGoalAction({
      send: (scope, action, payload) => send(scope, action, payload),
      setGoalState,
      setGoalRecord,
      setGoalContinuation,
    }),
    [send],
  );

  const disarmGoal = useCallback(() => {
    setGoalArm(null);
    goalArmRef.current = null;
  }, []);

  const onGoalAction = useCallback(
    async (action: GoalAction): Promise<GoalActionResult> => {
      setError(null);
      // A goal the operator set but has not started: arming is a local record,
      // not a command, because there is nothing to command yet (and on a
      // pending chat, no child at all). `executeSend` creates it at the fence
      // of the next prompt, with `startTurn: false` so that prompt is turn one.
      if (action.kind === 'create' && !goalRecord) {
        setGoalArm({
          kind: 'create',
          objective: action.objective,
          ...(action.tokenBudget === undefined ? {} : { tokenBudget: action.tokenBudget }),
          ...(action.maxTurns === undefined ? {} : { maxTurns: action.maxTurns }),
        });
        return { ok: true, armed: true };
      }
      if (action.kind === 'guided') {
        // An interview is a CONVERSATION, so it cannot create a goal record the
        // way `create` does — the model writes the objective at the end. It is
        // still ARMED: the operator's next message is what starts it, and
        // folding that message into the kickoff is what keeps the transcript
        // opening on their own words instead of on a question to nobody.
        setGoalArm({ kind: 'guided', rough: action.rough });
        return { ok: true, armed: true };
      }
      if (isPendingSessionId(sessionRef.current)) {
        // Pause/Resume/Drop/Budget describe a record a chat with no child does
        // not have; a start is handled above by arming.
        const reason = 'There is no goal in this chat yet. Set one first.';
        setError(reason);
        return { ok: false, error: reason };
      }
      const result = await runGoalAction(action);
      if (result.ok) setGoalArm(null);
      return result;
    },
    [runGoalAction, goalRecord],
  );

  const clearError = useCallback(() => setError(null), []);

  // omp's own mutual exclusion (`#enterGoalMode` refuses while plan mode is
  // active and vice versa), surfaced as an availability rule rather than as a
  // refusal the user has to read — and enforced in the child for the callers
  // this flag cannot reach (a stale client, a typed `/plan`).
  //
  // A chat on a non-omp ACP agent has no `/kabmo-mode` extension: Goal cannot be
  // expressed at all, and Plan exists only when that agent publishes a `plan`
  // value in its own mode selector (measured: claude does, opencode does not).
  // A button whose only outcome is a refusal is the shape this rule refuses.
  const available = modeAvailability(capabilities);

  return {
    plan,
    goal,
    goalOpen: goal || Boolean(goalRecord && isGoalOpen(goalRecord.status)),
    goalRecord,
    goalContinuation,
    goalEvaluating,
    pending,
    planAvailable: available.plan && !goal,
    goalAvailable: available.goal,
    sessionMode: sessionMode ?? pendingSession.mode,
    onSelectSessionMode,
    pendingAgentModeRef: pendingSession.spawnRef,
    error,
    clearError,
    spawnSelectionRef,
    goalArm,
    disarmGoal,
    goalArmRef,
    onTogglePlan,
    onGoalAction,
  };
}

export { EMPTY_MODE_SELECTION };
