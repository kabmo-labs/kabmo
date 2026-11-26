/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The approval gate, split out of the session.
 *
 * `session/request_permission` BLOCKS the agent's turn until it is answered, so
 * the session has exactly two obligations and they are the two functions here:
 * answer a call the operator's tier already allows WITHOUT parking it, and answer
 * every later dialog — a chosen option becomes `{outcome:"selected"}`, and an id
 * nobody knows becomes `cancelled`. A silent return hangs the agent, which is the
 * failure this module exists to make impossible.
 */

import type { AgentEvent } from '@kabmo-labs/kabmo-omp/rpc-protocol/constants';
import type { AcpId } from '@kabmo-labs/kabmo-acp/protocol/protocol';
import type { PendingPermissions } from '@kabmo-labs/kabmo-acp/client/permissions';
import type { ApprovalMode } from '@kabmo-labs/kabmo-omp/access-mode';
import { allowOption, autoApproval, type PermissionOption } from '@kabmo-labs/kabmo-acp/client/permissions';
import { permissionGrantKey } from '@kabmo-labs/kabmo-acp/client/grants';
import { reportAwaitingInput } from '@kabmo-labs/kabmo-live-sessions';
import { isRecord } from '@kabmo-labs/kabmo-guards';
import type { AcpSubagents } from '@kabmo-labs/kabmo-acp/mapper/subagents';

/**
 * The option id to select when the tier (or a standing grant) already allows
 * this call, or null to park it as a dialog.
 *
 * Answered HERE, before a dialog exists: parking it would ask a question the
 * operator's own selection already answered, and `isBusy()` would report a
 * dialog nobody is meant to see.
 */
export function preApprovedOption(
  accessMode: ApprovalMode,
  params: Record<string, unknown>,
  permissions?: PendingPermissions,
): string | null {
  const toolCall = params.toolCall && typeof params.toolCall === 'object'
    ? Object.fromEntries(Object.entries(params.toolCall))
    : undefined;
  const options = Array.isArray(params.options) ? (params.options as PermissionOption[]) : [];
  // A standing "always allow" is the operator's own answer to this exact call;
  // it wins over the tier, including one that would otherwise ask.
  if (permissions?.grants.has(permissionGrantKey(toolCall))) return allowOption(options, 'always');
  if (!autoApproval(accessMode, toolCall)) return null;
  return allowOption(options);
}

/** What `session/request_permission` returns; `AcpProcess` satisfies it. */
export interface AcpPermissionResponder {
  respond(id: string | number, result: unknown): void;
}

/**
 * Answer one parked request with the `cancelled` outcome.
 *
 * ACP requires this whenever the turn is cancelled: a cancelled prompt whose
 * permission request is still parked leaves the agent waiting on a question the
 * user can no longer see. `requestId` is a JSON-RPC id from `$/cancel_request`,
 * or the dialog id from the client's own Stop.
 */
export function cancelAcpPermission(
  permissions: PendingPermissions,
  responder: AcpPermissionResponder,
  requestId: string | number,
): boolean {
  const entry = permissions.take(String(requestId));
  if (!entry) return false;
  responder.respond(entry.id, { outcome: { outcome: 'cancelled' } });
  return true;
}

/** Cancel every parked request — the client's half of `session/cancel`. */
export function cancelAllAcpPermissions(
  permissions: PendingPermissions,
  responder: AcpPermissionResponder,
): number {
  const drained = permissions.drain();
  for (const entry of drained) {
    responder.respond(entry.id, { outcome: { outcome: 'cancelled' } });
  }
  return drained.length;
}

/** The slice of a session a permission request needs. */
export interface PermissionRequestHost {
  readonly sessionId: string;
  accessMode: ApprovalMode;
  readonly permissions: PendingPermissions;
  /** The announced children, so a child's request says whose it is. */
  readonly subagents?: AcpSubagents;
  emit(event: AgentEvent): void;
}

export type PermissionRequestAnswer =
  | { answered: true; result: unknown }
  | { answered: false; deferred: true };

/**
 * Answer one `session/request_permission`: a tier that already allows it is
 * selected immediately, otherwise the call is parked and reported as a dialog
 * whose id IS the JSON-RPC id (the answer arrives later and must name it).
 */
export function answerPermissionRequest(
  host: PermissionRequestHost,
  id: AcpId,
  params: Record<string, unknown>,
): Promise<PermissionRequestAnswer> {
  const optionId = preApprovedOption(host.accessMode, params, host.permissions);
  if (optionId) {
    return Promise.resolve({ answered: true, result: { outcome: { outcome: 'selected', optionId } } });
  }
  // The ADDRESSED session, not this one by default: a child's permission
  // arrives with the child's id, and recording the parent's id there put the
  // grant on the wrong session. An empty id is kept empty (the queue still
  // parks the dialog — the JSON-RPC id is what the answer names) instead of
  // being papered over with a session that was never asked.
  const requested = typeof params.sessionId === 'string' ? params.sessionId : '';
  // A child's approval must NAME the child: two subagents asking for the same
  // command would otherwise draw two identical dialogs with no way to tell
  // which work each one unblocks.
  const child = requested ? host.subagents?.get(requested) : undefined;
  const toolCall = isRecord(params.toolCall) ? params.toolCall : {};
  const title = typeof toolCall.title === 'string' && toolCall.title ? toolCall.title : 'approval';
  const addressed = child
    ? { ...params, toolCall: { ...toolCall, title: `${child.title ?? child.description ?? 'Subagent'} — ${title}` } }
    : params;
  const dialog = host.permissions.add(id, requested, addressed);
  host.emit(dialog as unknown as AgentEvent);
  // The agent is now blocked on the operator. Announced from the SERVER so the
  // banner arrives even when no page is open to see the dialog.
  // Announced against the PARENT chat: that is the page a reader has open, and
  // a child id is not a chat the notification feed can address.
  void reportAwaitingInput(host.sessionId);
  // Answered LATER; the transport must not send a refusal now or the agent
  // sees two answers to one request.
  return Promise.resolve({ answered: false, deferred: true });
}
