/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The approvals one ACP session is holding, as the `HarnessSession` contract
 * exposes them.
 *
 * A `session/request_permission` blocks the agent's turn, so the queue IS state
 * the client must be able to read after a reload and answer by id. Split from
 * `session.ts` because none of it is session lifecycle: it is a read and two
 * writes over `PendingPermissions`.
 */

import { settlePermissionDialog } from '@kabmo-labs/kabmo-acp-session-config/session-config';
import type { PendingPermissions } from '@kabmo-labs/kabmo-acp-client/permissions';
import { ACP_CONFIG_EFFECTS } from './config-effects';

/** The process slice answering a dialog needs. */
export interface AcpPermissionResponder {
  respond(id: string | number, result: unknown): void;
}

/** Dialogs a reattaching client has to draw again. */
export function acpPendingDialogs(permissions: PendingPermissions): Record<string, unknown>[] {
  // Widened for the shared `HarnessSession` contract, which predates the dialog
  // shape; every field the client reads is present.
  return permissions.pendingDialogs() as unknown as Record<string, unknown>[];
}

/** Answer one parked request with the option the operator clicked (or a yes/no
 *  decision when the frame carried no list). Returns the key it just granted,
 *  so the caller can persist a standing "always allow". */
export function answerAcpDialog(
  permissions: PendingPermissions,
  responder: AcpPermissionResponder,
  dialogId: string,
  confirmed: boolean,
  optionId?: string,
  /** The PARENT chat id: a child's grant is stored under the chat the operator
   *  will reopen, not under an agent-side child id Kabmo cannot address. */
  grantSessionId?: string,
): string | null {
  return settlePermissionDialog(permissions, responder, dialogId, {
    confirmed,
    ...(optionId ? { optionId } : {}),
    ...(grantSessionId ? { grantSessionId } : {}),
  }, ACP_CONFIG_EFFECTS);
}
