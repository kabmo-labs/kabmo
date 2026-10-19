/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The goal loop's driver: Kabmo asks the AUDITOR after every turn and
 * obeys the verdict.
 *
 * Ownership moved here from the child's extension deliberately. The extension
 * can see ceilings and budgets but not whether the objective was met, so with
 * the loop inside the child the only termination authority was the working
 * agent's own word. An independent auditor is a model call, which the child
 * cannot make — and Kabmo is where the session's turn boundaries, the
 * persisted goal record and the client stream all meet.
 *
 * What stays in the child: opening the continuation TURN. Only the extension
 * can send the hidden message (`display:false`) that re-enters the loop without
 * leaving a user bubble, and it is also where the hard stops live (token
 * budget, autoturn ceiling). So the driver PACES the loop — `goal continue` —
 * and the extension either opens the next turn or reports why it will not.
 *
 * Failure handling follows OpenChamber's rule: one unchecked continuation is
 * allowed, a second consecutive audit failure stops the goal rather than
 * driving blind to the turn cap.
 */

import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { loadPersistedModes } from '@/server/lib/omp/session/modes';
import { loadSessionModel } from '@/server/lib/omp/session/messages';
import { modeCommandPrompt } from '@/server/lib/omp/mode/request';
import { extractTextFromContent } from '@/shared/lib/omp/session/mapper';
import { decideGoalProgress, runGoalAudit, type GoalAuditAnswers, type GoalAuditRequest } from '@/server/lib/omp/session/goal-auditor.server';
import { readGoalSettings, type GoalSettings } from '@/server/lib/omp/session/goal-settings.server';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { GoalContinuationStop, GoalRecord } from '@/shared/lib/omp/mode/types';

/** What the driver needs from the session wrapper it was invoked on.
 *
 *  Optional so the frame fold can pass the host it already has: the real host
 *  (the session wrapper) carries all four, while a test host may carry only the
 *  fields the fold itself reads. `driveGoalAfterTurn` returns early without the
 *  ones it cannot work without — a driver that cannot send must not decide. */
export interface GoalDriverHost {
  sessionId?: string;
  cwd?: string;
  send?(command: Record<string, unknown>): Promise<unknown>;
  emit?(event: AgentEvent): void;
}

export interface GoalDriverContext {
  goal: GoalRecord;
  /** The loop's standing verdict; a stopped verdict means "do not drive". */
  continuationStop: GoalContinuationStop | 'complete' | undefined;
  /** The goal's own automatic-turn ceiling, persisted when it was created. */
  maxTurns?: number;
}

export interface GoalDriverDeps {
  audit?: (request: GoalAuditRequest) => Promise<GoalAuditAnswers | null>;
  context?: (sessionId: string) => Promise<GoalDriverContext | null>;
  model?: (sessionId: string) => Promise<string | undefined>;
  /** The loop's own settings (`goalAuditEnabled` / `goalAuditModel`). */
  settings?: () => Promise<GoalSettings>;
}

/** Consecutive "the agent needs the user" verdicts before the goal is stopped:
 *  one snag is never allowed to end a goal. */
export const BLOCKED_STRIKE_LIMIT = 3;
/** Consecutive audits that could not be taken. The first one continues
 *  unchecked; the second stops the goal. */
export const AUDIT_FAILURE_LIMIT = 2;

interface DriverState {
  goalId: string;
  strikes: number;
  failures: number;
  running: boolean;
}

/** Process-wide like the other server caches: a `bun --hot` reload re-evaluates
 *  this module while the sessions on the other side stay alive. */
function store(): Map<string, DriverState> {
  const global = globalThis as unknown as { __kabmoGoalDriver?: Map<string, DriverState> };
  global.__kabmoGoalDriver ??= new Map<string, DriverState>();
  return global.__kabmoGoalDriver;
}

/** Forget the strikes for a session — an explicit Resume is a fresh start. */
export function resetGoalDriverState(sessionId: string): void {
  store().delete(sessionId);
}

async function defaultContext(sessionId: string): Promise<GoalDriverContext | null> {
  const file = await findSessionFileById(sessionId);
  if (!file) return null;
  const modes = await loadPersistedModes(file);
  const goal = modes.goalRecord;
  if (!modes.goal || !goal || goal.status !== 'active') return null;
  return {
    goal,
    continuationStop: modes.goalContinuation?.stopped as GoalDriverContext['continuationStop'],
    maxTurns: modes.goalMaxTurns ?? undefined,
  };
}

async function defaultModel(sessionId: string): Promise<string | undefined> {
  const file = await findSessionFileById(sessionId);
  if (!file) return undefined;
  const model = await loadSessionModel(file);
  return model ? `${model.provider}/${model.modelId}` : undefined;
}

/** The last thing the agent said — what the auditor judges. */
export function lastAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const entry = messages[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (record.role !== 'assistant') continue;
    const text = extractTextFromContent(record.content).trim();
    if (text) return text;
  }
  return '';
}

export interface GoalTurnInput {
  host: GoalDriverHost;
  /** The frames `agent_end` carried: the turn's messages. */
  messages: unknown;
  deps?: GoalDriverDeps;
}

/**
 * One decision, after one turn.
 *
 * Called from the frame fold's terminal `agent_end`, which is the only moment
 * that knows a run has genuinely ended.
 */
export async function driveGoalAfterTurn({ host, messages, deps = {} }: GoalTurnInput): Promise<void> {
  const audit = deps.audit ?? runGoalAudit;
  const readContext = deps.context ?? defaultContext;
  const readModel = deps.model ?? defaultModel;
  const readSettings = deps.settings ?? readGoalSettings;
  const sessionId = host.sessionId;
  const cwd = host.cwd;
  // Bound, not destructured: the wrapper's `send` reaches into its own state
  // (`dispatchSessionCommand(this, …)`), so a bare function reference throws
  // "undefined is not an object" the moment the driver tries to send.
  const send = host.send?.bind(host);
  if (!sessionId || !cwd || !send) return;

  const settings = await readSettings();
  // Off means a goal still exists and can be paused/resumed by hand, but
  // nothing advances it on its own — no audit, no continuation.
  if (!settings.auditEnabled) return;

  const context = await readContext(sessionId);
  if (!context) {
    resetGoalDriverState(sessionId);
    return;
  }
  // A standing verdict is the operator's stop (ceiling, budget, blocked,
  // complete): the loop stays down until Resume clears it.
  if (context.continuationStop) return;

  const states = store();
  const previous = states.get(sessionId);
  const state: DriverState = previous && previous.goalId === context.goal.id
    ? previous
    : { goalId: context.goal.id, strikes: 0, failures: 0, running: false };
  states.set(sessionId, state);
  if (state.running) return;

  const answer = lastAssistantText(messages);
  if (!answer) return;

  // The configured auditor wins; the session's own model is the fallback, so a
  // goal loop never silently costs the operator a provider they did not pick.
  const model = settings.auditModel || (await readModel(sessionId));
  state.running = true;
  host.emit?.({ type: 'goal_evaluating', evaluating: true });
  let answers: GoalAuditAnswers | null = null;
  try {
    answers = await audit({ objective: context.goal.objective, answer, cwd, model });
  } finally {
    state.running = false;
    host.emit?.({ type: 'goal_evaluating', evaluating: false });
  }

  const command = (action: string, payload?: Record<string, unknown>) => {
    void send({ type: 'prompt', message: modeCommandPrompt({ scope: 'goal', action, payload }) });
  };
  // The child's ceiling map is per-process, and this driver may be talking to a
  // child that never saw the goal created (a resume, another Kabmo instance).
  // The persisted number rides every `continue` so the stop stays the goal's.
  const continueTurn = () => {
    command('continue', context.maxTurns === undefined ? undefined : { maxTurns: context.maxTurns });
  };

  if (!answers) {
    state.failures += 1;
    if (state.failures >= AUDIT_FAILURE_LIMIT) {
      // A checker that cannot answer must not drive the loop to the cap.
      command('done', { stopped: 'audit-failed' });
      return;
    }
    continueTurn();
    return;
  }

  state.failures = 0;
  const verdict = decideGoalProgress(answers);
  if (verdict === 'complete') {
    command('done', { stopped: 'complete' });
    return;
  }
  if (verdict === 'blocked') {
    state.strikes += 1;
    if (state.strikes >= BLOCKED_STRIKE_LIMIT) {
      command('done', { stopped: 'blocked' });
      return;
    }
    continueTurn();
    return;
  }
  state.strikes = 0;
  continueTurn();
}
