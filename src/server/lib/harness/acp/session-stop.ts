/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Stopping an ACP session's work, and what a closed turn moves.
 *
 * Split out of `session.ts` for the per-file ceiling, and because these three
 * actions share one rule: what the client settles LOCALLY and what it leaves to
 * the agent. The permission difference is the measured one — v1 blocks on the
 * client's answer, v2's agent knows which request belongs to the cancelled
 * foreground work (Zed models it as
 * `answers_permission_requests_on_cancel() === false`).
 */

import { cancelAllAcpPermissions } from '@/server/lib/harness/acp/session-permissions';
import { endAcpTurn } from '@/server/lib/harness/acp/session-turns';
import { LOST_SESSION_NOTICE } from '@/server/lib/harness/acp/session-lost';
import type { AcpSession } from '@/server/lib/harness/acp/session';
import type { AcpTurnEndInfo } from '@kabmo-labs/kabmo-acp-turn/turn';

/** Stop the turn and settle what it parked. */
export function cancelAcpTurn(session: AcpSession): void {
  session.background.stop();
  session.turns.cancel();
  session.process.cancelControlRequests?.(session.sessionId);
  // v1: the agent blocks until the approval is answered, so answer `cancelled`.
  // v2: only the agent knows which request belongs to the cancelled foreground
  // work; requests for background work must stay open.
  if (session.protocol === 1) cancelAllAcpPermissions(session.permissions, session.process);
}

/** Turn-end bookkeeping, then dispatch the input held behind it. */
export function endAcpSessionTurn(session: AcpSession, info: AcpTurnEndInfo): Promise<void> {
  const reported = endAcpTurn(session, info);
  const next = session.turns.takeQueued();
  if (next) {
    try {
      session.startTurn(next.message, next.images);
    } catch {
      // A turn that reopened first (a background interval) wins; the input is
      // dropped rather than re-queued behind an indefinite run.
    }
  }
  return reported;
}

/** Drop the session so the next command respawns and resumes the agent's own
 *  history. Called when the agent reports the session is gone. */
export function dropAcpSession(session: AcpSession): void {
  session.emit({ type: 'notice', level: 'warning', message: LOST_SESSION_NOTICE });
  void session.destroyAndWait();
}
