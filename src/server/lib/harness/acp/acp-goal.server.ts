/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Goal mode without omp's `/kabmo-mode` extension.
 *
 * A non-omp ACP agent has no extension to hold a goal record, and `omp-acp`'s
 * extension lives in a transcript this transport cannot re-read reliably. So
 * Kabmo owns the record here: the composer's actions write this row, the goal
 * driver reads it after every turn, and the modes route answers from it when
 * the process is gone.
 *
 * This is the SAME record shape omp publishes, which is what lets the existing
 * composer strip, markers and reload logic work unchanged. What differs is who
 * opens the continuation turn: the extension's hidden custom message is not
 * available on another agent, so the driver sends a visible prompt.
 */

import {
  KABMO_GOAL_CONTINUATION_MARKER,
  KABMO_GOAL_STATE_MARKER,
  KABMO_MODE_ERROR_MARKER,
  type GoalContinuation,
  type GoalContinuationStop,
  type GoalRecord,
} from '@/shared/lib/omp/mode/types';
import type { ModeRequest } from '@/server/lib/omp/mode/request';
import {
  DEFAULT_GOAL_MAX_TURNS,
  loadAcpGoalState,
  saveAcpGoalState,
  type AcpGoalState,
} from '@/server/lib/harness/acp/acp-goal-state.server';
import { notePromptTitle } from '@/server/lib/harness/session-title.server';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** The process surface these actions drive. `AcpSession` satisfies it. */
export interface AcpGoalHost {
  readonly sessionId: string;
  readonly harness: HarnessId;
  readonly cwd: string;
  readonly runModel: { provider: string; modelId: string } | null;
  /** Context tokens completed turns measured, when the driver can know them. */
  readonly usageTokens?: number;
  /** A new goal starts its budget from zero. */
  resetUsageTokens?: () => void;
  isAlive(): boolean;
  isBusy(): boolean;
  send(command: Record<string, unknown>): Promise<unknown>;
  emit(event: Record<string, unknown> & { type: string }): void;
}

/** Send one mode marker through the session's own frame stream. The client's
 *  fold parses `extension_ui_request`/`notify` exactly as it does for omp. */
export function emitModeMarker(host: AcpGoalHost, marker: string, payload: unknown): void {
  host.emit({ type: 'extension_ui_request', method: 'notify', message: `${marker}${JSON.stringify(payload)}` });
}

/** Publish the goal record (and its loop verdict) to the composer. */
export function emitGoalState(host: AcpGoalHost, state: AcpGoalState): void {
  emitModeMarker(host, KABMO_GOAL_STATE_MARKER, {
    goal: state.record,
    enabled: state.record?.status === 'active',
    ...(state.continuation ? { continuation: state.continuation } : {}),
  });
}

function emitError(host: AcpGoalHost, reason: string): void {
  emitModeMarker(host, KABMO_MODE_ERROR_MARKER, { scope: 'goal', reason });
}

/** The first turn of a goal created by Kabmo itself. */
export function goalKickoffPrompt(objective: string): string {
  return [
    'You are now working toward a goal that Kabmo will track across turns.',
    '',
    `Goal: ${objective}`,
    '',
    'Start now. Work until every part of the goal is done, then end with a short report of what you completed and what remains (if anything).',
  ].join('\n');
}

/** The instruction the driver sends after the auditor says "keep going". */
export function goalContinuationPrompt(objective: string): string {
  return [
    'Continue working toward the active goal.',
    '',
    `Goal: ${objective}`,
    '',
    'Pick up where you left off. Do not repeat finished work. End with a short report of what you completed and what remains.',
  ].join('\n');
}

function freshRecord(objective: string, tokenBudget?: number): GoalRecord {
  const now = Date.now();
  return {
    id: `acp-goal-${crypto.randomUUID()}`,
    objective,
    status: 'active',
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** A goal whose status still blocks a new one (omp refuses these too). */
function blocksCreate(status: GoalRecord['status']): boolean {
  return status === 'active' || status === 'paused' || status === 'budget-limited';
}

async function sendContinuation(host: AcpGoalHost, state: AcpGoalState): Promise<void> {
  if (!state.record || state.record.status !== 'active') return;
  if (host.isBusy()) return;
  const used = host.usageTokens ?? state.record.tokensUsed;
  if (state.record.tokenBudget !== undefined && used >= state.record.tokenBudget) {
    await finishAcpGoal(host, 'budget');
    return;
  }
  const maxTurns = state.maxTurns ?? DEFAULT_GOAL_MAX_TURNS;
  if (state.turns >= maxTurns) {
    await finishAcpGoal(host, 'max-turns');
    return;
  }
  const turns = state.turns + 1;
  const record = state.record
    ? {
        ...state.record,
        tokensUsed: host.usageTokens ?? state.record.tokensUsed,
        updatedAt: Date.now(),
        timeUsedSeconds: Math.max(0, Math.round((Date.now() - state.record.createdAt) / 1000)),
      }
    : state.record;
  const next = { ...state, record, turns, continuation: { turn: turns, maxTurns } };
  await saveAcpGoalState(host.sessionId, next);
  emitModeMarker(host, KABMO_GOAL_CONTINUATION_MARKER, { turn: turns, maxTurns });
  try {
    await host.send({ type: 'prompt', message: goalContinuationPrompt(state.record.objective), synthetic: true });
  } catch (error) {
    // A queued delivery or a dialog took the slot between the check and the
    // send. The next turn end drives again, so this is not a stopped goal.
    if (!host.isAlive()) return;
    emitError(host, error instanceof Error ? error.message : String(error));
  }
}

/** Continue the active goal from whatever row is on disk now. */
export async function continueAcpGoal(host: AcpGoalHost): Promise<void> {
  const state = await loadAcpGoalState(host.sessionId);
  await sendContinuation(host, state);
}

/** Close the loop with a verdict; every stop but `complete` stays resumable. */
export async function finishAcpGoal(host: AcpGoalHost, stopped: GoalContinuationStop): Promise<void> {
  const state = await loadAcpGoalState(host.sessionId);
  if (!state.record) return;
  const maxTurns = state.maxTurns ?? DEFAULT_GOAL_MAX_TURNS;
  const continuation: GoalContinuation = { turn: Math.max(1, state.turns), maxTurns, stopped };
  const record: GoalRecord = {
    ...state.record,
    status: stopped === 'complete' ? 'complete' : stopped === 'budget' ? 'budget-limited' : 'paused',
    tokensUsed: host.usageTokens ?? state.record.tokensUsed,
    updatedAt: Date.now(),
    timeUsedSeconds: Math.max(0, Math.round((Date.now() - state.record.createdAt) / 1000)),
  };
  const next = { ...state, record, continuation };
  await saveAcpGoalState(host.sessionId, next);
  emitModeMarker(host, KABMO_GOAL_CONTINUATION_MARKER, continuation);
  emitGoalState(host, next);
}

/** Apply one goal action from the composer's mode channel. */
export async function applyAcpGoalAction(
  host: AcpGoalHost,
  request: ModeRequest,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const payload = request.payload ?? {};
  const state = await loadAcpGoalState(host.sessionId);

  if (request.action === 'state') {
    return { ok: true, data: { enabled: state.record?.status === 'active', goal: state.record } };
  }

  if (request.action === 'create' || request.action === 'guided') {
    const guided = request.action === 'guided';
    const objective = guided
      ? String(payload.message ?? payload.rough ?? '').trim()
      : String(payload.objective ?? '').trim();
    if (!objective) return { ok: false, error: 'an objective is required' };
    if (state.record && blocksCreate(state.record.status)) {
      if (state.record.status === 'paused') {
        const resumed = { ...state, record: { ...state.record, status: 'active' as const, updatedAt: Date.now() }, continuation: null, turns: 0 };
        await saveAcpGoalState(host.sessionId, resumed);
        emitGoalState(host, resumed);
        if (payload.startTurn !== false) setTimeout(() => void continueAcpGoal(host), 250);
        return { ok: true, data: { goal: resumed.record, enabled: true } };
      }
      return { ok: false, error: 'this session already has a goal' };
    }
    const budget = typeof payload.tokenBudget === 'number' && Number.isInteger(payload.tokenBudget) && payload.tokenBudget > 0
      ? payload.tokenBudget
      : undefined;
    const maxTurns = typeof payload.maxTurns === 'number' && Number.isInteger(payload.maxTurns) && payload.maxTurns > 0
      ? payload.maxTurns
      : null;
    host.resetUsageTokens?.();
    const record = freshRecord(objective, budget);
    const next: AcpGoalState = { ...state, record, continuation: null, maxTurns, turns: 0 };
    await saveAcpGoalState(host.sessionId, next);
    // The goal's own name is a better chat title than the kickoff boilerplate.
    void notePromptTitle(host.sessionId, objective);
    emitGoalState(host, next);
    if (payload.startTurn !== false) {
      await host.send({ type: 'prompt', message: goalKickoffPrompt(objective), synthetic: true });
    }
    return { ok: true, data: { goal: record, enabled: true } };
  }

  if (!state.record) return { ok: false, error: 'there is no goal in this chat' };

  switch (request.action) {
    case 'pause': {
      const next = { ...state, record: { ...state.record, status: 'paused' as const, updatedAt: Date.now() } };
      await saveAcpGoalState(host.sessionId, next);
      emitGoalState(host, next);
      return { ok: true, data: { goal: next.record, enabled: false } };
    }
    case 'resume': {
      const next = {
        ...state,
        record: { ...state.record, status: 'active' as const, updatedAt: Date.now() },
        continuation: null,
        turns: 0,
      };
      await saveAcpGoalState(host.sessionId, next);
      emitGoalState(host, next);
      setTimeout(() => void continueAcpGoal(host), 250);
      return { ok: true, data: { goal: next.record, enabled: true } };
    }
    case 'drop': {
      const next = { ...state, record: { ...state.record, status: 'dropped' as const, updatedAt: Date.now() }, continuation: null };
      await saveAcpGoalState(host.sessionId, next);
      emitGoalState(host, next);
      return { ok: true, data: { goal: next.record, enabled: false } };
    }
    case 'budget': {
      const value = payload.value;
      const tokenBudget = typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
      const record = { ...state.record, tokenBudget, updatedAt: Date.now() };
      if (tokenBudget === undefined) delete (record as { tokenBudget?: number }).tokenBudget;
      const next = { ...state, record };
      await saveAcpGoalState(host.sessionId, next);
      emitGoalState(host, next);
      return { ok: true, data: { goal: next.record, enabled: record.status === 'active' } };
    }
    case 'done': {
      const stopped = payload.stopped;
      const reason = stopped === 'budget' || stopped === 'max-turns' || stopped === 'blocked' || stopped === 'complete' || stopped === 'audit-failed'
        ? stopped
        : 'complete';
      await finishAcpGoal(host, reason);
      return { ok: true, data: { goal: (await loadAcpGoalState(host.sessionId)).record } };
    }
    case 'continue':
      await continueAcpGoal(host);
      return { ok: true, data: { goal: (await loadAcpGoalState(host.sessionId)).record } };
    default:
      return { ok: false, error: `unknown goal action: ${request.action}` };
  }
}
