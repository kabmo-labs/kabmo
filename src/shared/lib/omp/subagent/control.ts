/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Client calls for controlling ONE running subagent.
 *
 * The endpoints act on the session's live child, so a session this server does
 * not manage answers 409 (`session_not_running`) — the roster row and the
 * transcript banner both disable their buttons while the subagent is not
 * running, so the refusal is a guard against a stale click rather than a normal
 * outcome.
 */

/** Hard-kill one running subagent. Resolves false when it was not running. */
export async function cancelSubagent(sessionId: string, subagentId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(subagentId)}/cancel`,
      { method: 'POST' },
    );
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { data?: { cancelled?: unknown } } | null;
    return body?.data?.cancelled === true;
  } catch {
    return false;
  }
}

/** Send a message to one running subagent as its user. */
export async function steerSubagent(sessionId: string, subagentId: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(subagentId)}/steer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
