/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Agent→client requests for an ACP session.
 *
 * Every branch answers or refuses — an unanswered call parks the turn — and the
 * approval branch is the same code the in-process tier uses, so a dialog and an
 * auto-answer cannot disagree.
 */

import { answerPermissionRequest, cancelAcpPermission } from '@/server/lib/harness/acp/session-permissions';
import { handleAcpFsRequest, isAcpFsMethod } from '@/server/lib/harness/acp/client-fs';
import { ACP_ERROR } from '@/server/lib/harness/acp/protocol';
import { normalizePermissionParams } from '@/server/lib/harness/acp/v2';
import type { AcpId, AcpProtocolVersion } from '@/server/lib/harness/acp/protocol';
import type { PendingPermissions } from '@/server/lib/harness/acp/permissions';
import type { AcpSubagents } from '@/server/lib/harness/acp/subagents';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';

export interface AcpClientRequestHost {
  readonly sessionId: string;
  readonly cwd: string;
  readonly protocol: AcpProtocolVersion;
  accessMode: ApprovalMode;
  permissions: PendingPermissions;
  /** The announced children: a child's request must name the child, and its
   *  `fs/*` calls are confined to the child's own working directory. */
  readonly subagents?: AcpSubagents;
  emit: (event: AgentEvent) => void;
}

export type AcpClientRequestAnswer =
  | { answered: true; result: unknown }
  | { answered: false; message: string; code?: number }
  | { answered: false; deferred: true };

export function handleAcpClientRequest(
  host: AcpClientRequestHost,
  id: AcpId,
  method: string,
  params: Record<string, unknown>,
): Promise<AcpClientRequestAnswer> {
  if (method === 'session/request_permission') {
    // v2 restructured this call: a required `title` and an optional `subject`
    // replace the v1 `toolCall`. The approval queue keeps its v1 shape.
    const normalized = host.protocol === 2 ? normalizePermissionParams(params) : params;
    return answerPermissionRequest({
      sessionId: host.sessionId,
      accessMode: host.accessMode,
      permissions: host.permissions,
      ...(host.subagents ? { subagents: host.subagents } : {}),
      emit: (event) => host.emit(event),
    }, id, normalized);
  }
  // The file surface the client advertised at `initialize`. Routed before the
  // refusal so an agent that took the advertisement at its word gets an answer.
  if (isAcpFsMethod(method)) {
    const subagents = host.subagents;
    return handleAcpFsRequest({
      cwd: host.cwd,
      sessionId: host.sessionId,
      ...(subagents
        ? {
            cwdFor: (sessionId: string | undefined) => (sessionId ? subagents.get(sessionId)?.cwd : undefined) ?? host.cwd,
            owns: (sessionId: string) => sessionId === host.sessionId || subagents.has(sessionId),
          }
        : {}),
      emit: (event) => host.emit(event),
    }, method, params);
  }
  // Cursor asks the CLIENT to run a nested task (`cursor/task`, measured on
  // cursor-agent 2026.08.11). Answering `-32601` made its adapter fall back with
  // an error in the middle of a delegation the tool card had already drawn; an
  // empty result is what the adapter expects from a client that does not run
  // the child itself.
  if (method === 'cursor/task') return Promise.resolve({ answered: true, result: {} });
  // `-32601`, not "internal error": the agent decides from the code whether this
  // client simply lacks the method (Spec §Errors).
  return Promise.resolve({
    answered: false,
    message: `Kabmo does not implement ${method}`,
    code: ACP_ERROR.methodNotFound,
  });
}

/** The host a cancellation notification needs; `AcpSession` satisfies it. */
export interface AcpCancelHost {
  readonly permissions: PendingPermissions;
  respond(id: AcpId, result: unknown): void;
}

/**
 * Handle `$/cancel_request` — the agent withdrawing a request it made on this
 * client. The only long-lived one Kabmo parks is an approval, and ACP requires
 * the `cancelled` outcome for it. Returns false for a different method so the
 * caller keeps routing.
 */
export function handleAcpCancelRequest(
  host: AcpCancelHost,
  method: string,
  params: Record<string, unknown>,
): boolean {
  if (method !== '$/cancel_request') return false;
  const requestId = params.requestId;
  if (typeof requestId === 'string' || typeof requestId === 'number') {
    cancelAcpPermission(host.permissions, host, requestId);
  }
  return true;
}
