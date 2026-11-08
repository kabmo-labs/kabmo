/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The goal loop for an ACP chat.
 *
 * The RPC driver obeys a `/kabmo-mode goal continue` answered by the child's
 * extension; ACP has no such extension, so this driver opens the next turn
 * itself after auditing the last one. The DECISION is shared with the RPC path
 * (`decideGoalProgress`, `runGoalAudit`, `readGoalSettings`), because a goal
 * must not mean two different things depending on the transport.
 *
 * It runs from the ACP turn's terminal settle — the only moment that knows the
 * answer is complete. A turn that is already busy (a queued follow-up, an
 * approval dialog) is left alone: the next turn end drives again, so a skip is
 * a delay, not a stopped goal.
 */

import {
  AUDIT_FAILURE_LIMIT,
  BLOCKED_STRIKE_LIMIT,
  lastAssistantText,
} from '@/server/lib/omp/session/goal-driver.server';
import { decideGoalProgress, type GoalAuditAnswers } from '@/server/lib/omp/session/goal-auditor.server';
import { readGoalSettings } from '@/server/lib/omp/session/goal-settings.server';
import { runAcpGoalAudit, type AcpGoalAuditRequest } from '@/server/lib/harness/acp/acp-audit.server';
import type { GoalContinuationStop } from '@/shared/lib/omp/mode/types';
import {
  continueAcpGoal,
  finishAcpGoal,
  type AcpGoalHost,
} from '@/server/lib/harness/acp/acp-goal.server';
import { hasAcpGoalSession, loadAcpGoalState } from '@/server/lib/harness/acp/acp-goal-state.server';

interface DriverState {
  goalId: string;
  strikes: number;
  failures: number;
  running: boolean;
}

function store(): Map<string, DriverState> {
  const global = globalThis as unknown as { __kabmoAcpGoalDriver?: Map<string, DriverState> };
  global.__kabmoAcpGoalDriver ??= new Map();
  return global.__kabmoAcpGoalDriver;
}

/** An explicit Resume is a fresh audit record. */
export function resetAcpGoalDriver(sessionId: string): void {
  store().delete(sessionId);
}

function evaluating(host: AcpGoalHost, on: boolean): void {
  host.emit({ type: 'goal_evaluating', evaluating: on });
}

export interface AcpGoalDriverDeps {
  audit?: (request: AcpGoalAuditRequest) => Promise<GoalAuditAnswers | null>;
  settings?: typeof readGoalSettings;
}

/**
 * One decision after one completed ACP turn.
 *
 * `message` is the assistant message the mapper closed. A cancelled turn has no
 * report to audit and must not spend a model call, so callers pass the stop
 * reason and this returns early for it.
 */
export async function driveAcpGoalAfterTurn(
  host: AcpGoalHost,
  message: unknown,
  options: { cancelled?: boolean; deps?: AcpGoalDriverDeps } = {},
): Promise<void> {
  if (options.cancelled) return;
  if (!host.isAlive()) return;
  // The common case: this chat never had a goal, so no DB read is needed.
  if (!hasAcpGoalSession(host.sessionId)) return;
  const state = await loadAcpGoalState(host.sessionId);
  if (!state.record || state.record.status !== 'active') {
    store().delete(host.sessionId);
    return;
  }
  if (state.continuation?.stopped) return;
  const used = host.usageTokens ?? state.record.tokensUsed;
  if (state.record.tokenBudget !== undefined && used >= state.record.tokenBudget) {
    await finishAcpGoal(host, 'budget');
    return;
  }

  const settings = await (options.deps?.settings ?? readGoalSettings)();
  if (!settings.auditEnabled) return;

  const answer = lastAssistantText([message]);
  if (!answer) return;

  const states = store();
  const previous = states.get(host.sessionId);
  const driver: DriverState = previous && previous.goalId === state.record.id
    ? previous
    : { goalId: state.record.id, strikes: 0, failures: 0, running: false };
  states.set(host.sessionId, driver);
  if (driver.running) return;

  const audit = options.deps?.audit ?? runAcpGoalAudit;

  driver.running = true;
  evaluating(host, true);
  let answers: GoalAuditAnswers | null;
  try {
    answers = await audit({
      harness: host.harness,
      cwd: host.cwd,
      model: host.runModel,
      objective: state.record.objective,
      answer,
    });
  } finally {
    driver.running = false;
    evaluating(host, false);
  }

  const stop = (reason: GoalContinuationStop) => finishAcpGoal(host, reason);

  if (!answers) {
    driver.failures += 1;
    if (driver.failures >= AUDIT_FAILURE_LIMIT) {
      await stop('audit-failed');
      return;
    }
    await continueAcpGoal(host);
    return;
  }

  driver.failures = 0;
  const verdict = decideGoalProgress(answers);
  if (verdict === 'complete') {
    await stop('complete');
    return;
  }
  if (verdict === 'blocked') {
    driver.strikes += 1;
    if (driver.strikes >= BLOCKED_STRIKE_LIMIT) {
      await stop('blocked');
      return;
    }
    await continueAcpGoal(host);
    return;
  }
  driver.strikes = 0;
  await continueAcpGoal(host);
}
