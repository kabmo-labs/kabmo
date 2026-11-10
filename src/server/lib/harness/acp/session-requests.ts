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

import { answerPermissionRequest } from '@/server/lib/harness/acp/session-permissions';
import type { AcpId } from '@/server/lib/harness/acp/protocol';
import type { PendingPermissions } from '@/server/lib/harness/acp/permissions';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';

export interface AcpClientRequestHost {
  sessionId: string;
  accessMode: ApprovalMode;
  permissions: PendingPermissions;
  emit: (event: AgentEvent) => void;
}

export type AcpClientRequestAnswer =
  | { answered: true; result: unknown }
  | { answered: false; message: string }
  | { answered: false; deferred: true };

export function handleAcpClientRequest(
  host: AcpClientRequestHost,
  id: AcpId,
  method: string,
  params: Record<string, unknown>,
): Promise<AcpClientRequestAnswer> {
  if (method === 'session/request_permission') {
    return answerPermissionRequest({
      sessionId: host.sessionId,
      accessMode: host.accessMode,
      permissions: host.permissions,
      emit: (event) => host.emit(event),
    }, id, params);
  }
  return Promise.resolve({ answered: false, message: `Kabmo does not implement ${method}` });
}
