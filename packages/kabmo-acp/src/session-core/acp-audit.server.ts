/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The goal auditor for an ACP chat, run through the SAME harness.
 *
 * `runGoalAudit` spawns `omp -p` with an omp model, which is the wrong agent for
 * an ACP chat: the model name (`claude/opus`) is not one omp resolves, and the
 * verdict would come from a different agent than the one doing the work. This
 * opens a one-shot ACP session on the chat's harness, applies the chat's own
 * model, asks the same classification prompt, and reads the reply. The harness's
 * own config/env (and therefore its own tools and MCP setup) is what runs — no
 * omp RPC child is involved.
 *
 * The session is disposable: no registry entry, no stream row, no title, no
 * goal driver. Only the assistant text is kept. The transport itself lives in
 * `one-shot.server.ts`, shared with the commit-message generator.
 */

import { runAcpOneShot } from './one-shot.server';
import {
  buildGoalAuditPrompt,
  readGoalAuditAnswers,
  type GoalAuditAnswers,
} from '@kabmo-labs/kabmo-omp/session-runtime/goal-auditor.server';
import type { HarnessId } from '@kabmo-labs/kabmo-harness/catalog';

export interface AcpGoalAuditRequest {
  harness: HarnessId;
  cwd: string;
  /** The chat's own model, as the agent resolved it. */
  model: { provider: string; modelId: string } | null;
  objective: string;
  answer: string;
  timeoutMs?: number;
}

/**
 * Ask the ACP agent to classify the last turn's report.
 *
 * Null means the check could not be taken (launch failure, timeout, no usable
 * reply); the driver treats that the same way it treats an omp audit failure.
 */
export async function runAcpGoalAudit(request: AcpGoalAuditRequest): Promise<GoalAuditAnswers | null> {
  const outcome = await runAcpOneShot({
    harness: request.harness,
    cwd: request.cwd,
    model: request.model,
    prompt: buildGoalAuditPrompt(request.objective, request.answer),
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    // The audit is a classification, not a task: the agent may use its own
    // tools to read the report, and the prompt is the only thing it is asked.
    denyTools: false,
  });
  return outcome.ok ? readGoalAuditAnswers(outcome.text) : null;
}
