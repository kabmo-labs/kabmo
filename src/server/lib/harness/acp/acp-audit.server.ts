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
 * goal driver. Only the assistant text is kept.
 */

import { AcpSession } from '@/server/lib/harness/acp/session';
import { loadHarnessConfig, resolveLaunch } from '@/server/lib/harness/config.server';
import { sessionLaunchCommand } from '@/server/lib/harness/launch';
import {
  buildGoalAuditPrompt,
  readGoalAuditAnswers,
  type GoalAuditAnswers,
} from '@/server/lib/omp/session/goal-auditor.server';
import { extractTextFromContent } from '@/shared/lib/omp/session/mapper';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

export interface AcpGoalAuditRequest {
  harness: HarnessId;
  cwd: string;
  /** The chat's own model, as the agent resolved it. */
  model: { provider: string; modelId: string } | null;
  objective: string;
  answer: string;
  timeoutMs?: number;
}

/** How long one audit may take. The harness may be slower than print mode. */
const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Ask the ACP agent to classify the last turn's report.
 *
 * Null means the check could not be taken (launch failure, timeout, no usable
 * reply); the driver treats that the same way it treats an omp audit failure.
 */
export async function runAcpGoalAudit(request: AcpGoalAuditRequest): Promise<GoalAuditAnswers | null> {
  let launch;
  try {
    const configured = await loadHarnessConfig(request.harness);
    launch = resolveLaunch(request.harness, configured);
  } catch {
    return null;
  }

  const session = new AcpSession(
    {
      harness: request.harness,
      command: sessionLaunchCommand(request.harness, launch.command),
      ...(launch.env ? { env: launch.env } : {}),
      model: request.model,
      // A classification, not a task: the cheapest level the agent offers.
      thinkingLevel: 'off',
      accessMode: 'yolo',
    },
    request.cwd,
  );
  // A disposable reader: no stream row, no turn settle, no queue, no title.
  session.markStream = () => {};
  session.onTurnEnded = () => {};

  const events: AgentEvent[] = [];
  session.onEvent((event) => events.push(event));
  const ended = Promise.withResolvers<void>();
  const stop = session.onEvent((event) => {
    if (event.type === 'agent_end') ended.resolve();
  });
  const timer = setTimeout(() => {
    void session.destroyAndWait();
    ended.resolve();
  }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    await session.start();
    // `synthetic` keeps the audit prompt from becoming this session's title.
    await session.send({
      type: 'prompt',
      message: buildGoalAuditPrompt(request.objective, request.answer),
      synthetic: true,
    });
    await ended.promise;
    const message = [...events].reverse().find((event) => event.type === 'message_end')?.message;
    if (!message || typeof message !== 'object' || !('content' in message)) return null;
    return readGoalAuditAnswers(extractTextFromContent((message as { content: unknown }).content));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    stop();
    await session.destroyAndWait().catch(() => {});
  }
}
