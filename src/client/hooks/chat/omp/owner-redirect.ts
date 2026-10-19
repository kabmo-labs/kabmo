/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Client half of the cross-process session-ownership guard.
 *
 * The server refuses to resume a session another omp process already owns
 * (`SessionOwnedElsewhereError`), because doing so makes omp move this writer
 * to a sibling file — a duplicate sidebar row with the same title and a split
 * conversation. When the owner is another Kabmo instance, the refusal carries
 * its port, and the right answer is not an error message: it is to open the
 * session there, since both instances share one database and one agent dir.
 *
 * A holder Kabmo cannot place (an `omp` CLI run) has no `ownerPort`, so
 * the caller keeps the plain refusal.
 */

/** Fields the server adds to a `session_owned_elsewhere` response. */
export interface SessionOwnerConflict {
  code?: string;
  ownerPort?: number | null;
  sessionId?: string;
}

/**
 * Navigate this tab to the instance that owns the session.
 *
 * Returns true when the browser was sent somewhere — the caller must stop
 * treating the response as an ordinary failure. Same host, new port, same
 * session id: the tab keeps its place and lands on the writer that owns the
 * conversation.
 */
export function redirectToOwningInstance(body: SessionOwnerConflict, fallbackSessionId: string): boolean {
  if (body.code !== 'session_owned_elsewhere') return false;
  const port = body.ownerPort;
  if (!port) return false;
  const url = new URL(window.location.href);
  url.port = String(port);
  url.searchParams.set('sessionId', body.sessionId || fallbackSessionId);
  window.location.assign(url.toString());
  return true;
}
