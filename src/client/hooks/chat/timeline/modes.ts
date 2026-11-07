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
import { postModeCommand } from '@/client/hooks/chat/timeline/mode-post';
import { isGoalOpen } from '@/shared/lib/omp/mode/status';
import { isPendingSessionId } from '@/shared/lib/omp/session/default-title';
import { isModeMarker } from '@/shared/lib/omp/mode/constants';
import type { ArmedGoal, GoalAction } from '@/shared/lib/omp/mode/actions';

import type { ChatTimelineModes } from '@/client/hooks/chat/timeline/modes-contract';

export type { ChatTimelineModes };
export type { ArmedGoal, GoalAction };

/**
 * Which mode toggles a harness can actually honour.
 *
 * Pure, so the rule is testable without a render. omp over RPC carries the
 * whole `/kabmo-mode` extension AND the goal driver, so both modes exist.
 * `omp-acp` carries the extension command but not the driver: Plan works
 * through the agent's own `mode` selector, Goal would be a button the server
 * refuses. Another ACP agent has no extension at all — Plan is a real mode only
 * when that agent publishes a `plan` value (measured: claude does, opencode does
 * not). An unknown harness keeps the old surface: the row may simply not have
 * arrived yet.
 */
export function modeAvailability(capabilities: ModeCapabilities): { plan: boolean; goal: boolean } {
  // Goal is an omp RPC feature end to end: the `/kabmo-mode` command opens the
  // turn, but the LOOP (audit → continuation) is driven by Kabmo's RPC
  // terminal settle, and its state arrives as extension notifications the ACP
  // adapter does not forward. Offering the toggle on `omp-acp` produced a
  // button whose every action the server answered with "has no goal mode" —
  // the refusal rule this function exists to enforce.
  if (capabilities.harness === 'omp-rpc') return { plan: true, goal: true };
  const ompTransport = capabilities.harness === 'omp-acp';
  if (ompTransport) return { plan: true, goal: false };
  if (!capabilities.harness) return { plan: true, goal: true };
  return { plan: capabilities.modeValues?.includes('plan') === true, goal: false };
}

export interface ModeCapabilities {
  /** The harness that owns this chat, when the tab knows it. */
  harness?: string | null;
  /** The harness's own `mode` values, from its probe: `plan` is a real mode on
   *  the agents that publish one. */
  modeValues?: string[];
}

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
