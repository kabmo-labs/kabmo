/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Stop-button escalation for a live session.
 *
 * `abort` is awaited server-side until the turn actually stops, so a session
 * wedged on a subagent — or on a child that stopped answering — never replies
 * to it and the Stop button would hang with it. If the abort request is still
 * pending after the grace period it is cancelled here and the stop escalates to
 * `force_reset`, which the server answers by destroying the session's omp child
 * (and every subagent under it) instead of waiting for a clean stop.
 */

/** How long a stop may take before the process is reset instead. */
const ABORT_GRACE_MS = 10_000;

function postCommand(sessionId: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

/** Ask the session to stop, then reset its process if it does not stop in time.
 *  Failures are swallowed: the event stream is the source of truth for state. */
export async function stopAgentSession(sessionId: string): Promise<void> {
  const grace = new AbortController();
  const timer = setTimeout(() => grace.abort(), ABORT_GRACE_MS);
  try {
    const stopped = await postCommand(sessionId, { type: 'abort' }, grace.signal).then(() => true, () => false);
    if (stopped) return;
    await postCommand(sessionId, { type: 'force_reset' }).catch(() => null);
  } finally {
    clearTimeout(timer);
  }
}
