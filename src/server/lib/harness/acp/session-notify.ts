/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The order one agent notification is routed in.
 *
 * The order IS the rule: the idle clock and the silence ceiling must see every
 * frame (that is the only evidence a turn is alive), `$/cancel_request` must be
 * answered before the frame is folded, a `session/load` replay belongs to the
 * background probe, and the raw panel reads the ORIGINAL payload — so the frame
 * log is fed before the mapper folds it and before the turn gate can drop one.
 */

import { handleAcpCancelRequest } from '@/server/lib/harness/acp/session-requests';
import { handleSessionNotification, type AcpNotificationHost } from '@/server/lib/harness/acp/session-notifications';
import type { RawNotificationSink } from '@kabmo-labs/kabmo-acp-protocol/raw-listeners';
import type { PendingPermissions } from '@kabmo-labs/kabmo-acp-client/permissions';

/** What one routed notification reads. */
export interface AcpNotifyHost extends AcpNotificationHost {
  readonly rawSink: RawNotificationSink;
  readonly background: { consume(method: string, params: Record<string, unknown>): boolean };
  readonly turns: { noteActivity(): void };
  readonly idle: { reset(): void };
  /** The approval queue, for a withdrawn `$/cancel_request`. */
  respond(id: string | number, result: unknown): void;
  readonly permissions: PendingPermissions;
}

export function handleAcpNotification(
  host: AcpNotifyHost,
  method: string,
  params: Record<string, unknown>,
): void {
  // A long turn emits no commands but plenty of `session/update` frames.
  host.idle.reset();
  // The same frames are the only evidence a turn is still alive: ACP has no
  // probe, so the silence ceiling is what bounds a wedged agent.
  host.turns.noteActivity();
  // The agent withdrawing a request it made; the approval it parks is answered.
  if (handleAcpCancelRequest(host, method, params)) return;
  // A `session/load` probe's replay repeats the whole chat; it is the probe's.
  if (host.background.consume(method, params)) return;
  if (method === 'session/update') host.rawSink.emit(method, params);
  handleSessionNotification(host, method, params);
}
