/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One disposable ACP turn: spawn the harness, ask one question, read the text.
 *
 * The goal auditor and the commit-message generator both need an answer from
 * the SAME agent the user is talking to — its auth, its model, its config —
 * without creating a chat row, a stream row, a title or a registry entry. This
 * module owns that shape once; a second copy is how one caller would keep the
 * permission gate while the other quietly let the agent edit the repository.
 *
 * `denyTools` is the default because both callers ask for TEXT. ACP has no
 * universal `--no-tools` flag, so the gate is the permission request: every
 * `session/request_permission` is answered `cancelled`, and the prompt tells
 * the agent the supplied context is all it needs. The goal auditor opts out
 * (`denyTools: false`) because its classification prompt is the only thing it
 * ever asks and the agent may need its own tools to read the report.
 */

import { AcpSession } from '@/server/lib/harness/acp/session';
import { loadHarnessConfig, resolveLaunch } from '@/server/lib/harness/config.server';
import { sessionLaunchCommand } from '@/server/lib/harness/launch';
import { extractTextFromContent } from '@/shared/lib/omp/session/mapper';
import type { AcpSessionOptions } from '@/server/lib/harness/acp/session-options';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

export interface AcpOneShotRequest {
  harness: HarnessId;
  cwd: string;
  /** The chat's own model, as the agent resolved it. Null = the agent default. */
  model: { provider: string; modelId: string } | null;
  prompt: string;
  timeoutMs?: number;
  /** Deny every tool permission request. Default true. */
  denyTools?: boolean;
}

export type AcpOneShotOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: 'launch' | 'timeout' | 'no-reply' | 'error'; detail?: string };

export interface AcpOneShotDeps {
  /** Test seam: a fake session, so the protocol shape can be asserted without
   *  spawning an agent. */
  createSession?: (options: AcpSessionOptions, cwd: string) => AcpSession;
}

const DEFAULT_TIMEOUT_MS = 90_000;

export async function runAcpOneShot(
  request: AcpOneShotRequest,
  deps: AcpOneShotDeps = {},
): Promise<AcpOneShotOutcome> {
  let launch;
  try {
    const configured = await loadHarnessConfig(request.harness);
    launch = resolveLaunch(request.harness, configured);
  } catch (error) {
    return {
      ok: false,
      reason: 'launch',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const create = deps.createSession ?? ((options, cwd) => new AcpSession(options, cwd));
  const session = create(
    {
      harness: request.harness,
      command: sessionLaunchCommand(request.harness, launch.command),
      ...(launch.env ? { env: launch.env } : {}),
      model: request.model,
      // A text answer, not a task: the cheapest level the agent offers.
      thinkingLevel: 'off',
      // `always-ask` parks every tool call; the listener below answers it
      // `cancelled`. `yolo` would let the agent edit the repository.
      accessMode: request.denyTools === false ? 'yolo' : 'always-ask',
    },
    request.cwd,
  );
  // A disposable reader: no stream row, no turn settle, no queue, no title.
  session.markStream = () => {};
  session.onTurnEnded = async () => {};

  const events: AgentEvent[] = [];
  const stopEvents = session.onEvent((event) => events.push(event));
  const ended = Promise.withResolvers<void>();
  let timedOut = false;
  const stopEnd = session.onEvent((event) => {
    if (event.type === 'agent_end') ended.resolve();
  });
  const stopPermissions = request.denyTools === false
    ? () => {}
    : session.onEvent((event) => {
        // `session-permissions.ts` emits the permission dialog as an
        // `AgentEvent`; its shape is the dialog, not a union member.
        const record = event as unknown as { type?: string; id?: unknown };
        if (record.type !== 'extension_ui_request') return;
        if (typeof record.id !== 'string' && typeof record.id !== 'number') return;
        session.respond(record.id, { outcome: { outcome: 'cancelled' } });
      });

  const timer = setTimeout(() => {
    timedOut = true;
    void session.destroyAndWait();
    ended.resolve();
  }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    await session.start();
    // `synthetic` keeps the one-shot prompt from becoming a session title.
    await session.send({ type: 'prompt', message: request.prompt, synthetic: true });
    await ended.promise;
    if (timedOut) return { ok: false, reason: 'timeout' };
    const message = [...events].reverse().find((event) => event.type === 'message_end')?.message;
    if (!message || typeof message !== 'object' || !('content' in message)) {
      return { ok: false, reason: 'no-reply' };
    }
    const text = extractTextFromContent(message.content).trim();
    return text ? { ok: true, text } : { ok: false, reason: 'no-reply' };
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    stopEvents();
    stopEnd();
    stopPermissions();
    // Remove the disposable session from the agent's own history when it
    // advertises `session/delete`. A refusal is not the answer's failure.
    await session.deleteAgentSession().catch(() => false);
    await session.destroyAndWait().catch(() => {});
  }
}
