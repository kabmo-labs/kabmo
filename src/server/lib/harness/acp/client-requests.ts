/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Answering a call the AGENT made on this client.
 *
 * Split out of `client.ts` for the per-file ceiling, and because the rule is
 * its own subject: an unanswered agent→client call parks the turn, so every
 * branch here either answers, defers (the approval dialog answers later through
 * `respond`), or refuses WITH a code the agent can act on. Dropping a call is
 * the one outcome this module must never produce.
 */

import type { AcpId } from '@kabmo-labs/kabmo-acp-protocol/protocol';
import type { AcpClientRequestHandler } from '@/server/lib/harness/acp/client';

/** The transport seams one answer needs. */
export interface AgentRequestResponder {
  respond(id: AcpId, result: unknown): void;
  respondError(id: AcpId, message: string, code?: number): void;
}

export async function answerAgentRequest(
  responder: AgentRequestResponder,
  ask: AcpClientRequestHandler | undefined,
  id: AcpId,
  method: string,
  params: unknown,
): Promise<void> {
  const bag = (params ?? {}) as Record<string, unknown>;
  try {
    const handled = await ask?.(id, method, bag);
    if (handled?.answered) {
      responder.respond(id, handled.result);
      return;
    }
    // A deferred call is answered LATER through `respond(id, …)` — the approval
    // dialog works this way, and sending a refusal here would answer the same
    // request twice.
    if (handled && 'deferred' in handled) return;
    // A refusal is REQUIRED, and the code travels with it so the agent can fall
    // back (`-32601` is "this client lacks the method", not "it broke").
    responder.respondError(id, handled?.message ?? `Kabmo does not implement ${method}`, handled?.code);
  } catch (error) {
    responder.respondError(id, error instanceof Error ? error.message : String(error));
  }
}
