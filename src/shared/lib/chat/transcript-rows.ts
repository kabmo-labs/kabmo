/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a stored transcript already holds.
 *
 * A user-only row is a prompt the client wrote before its tab closed; the
 * answer is still only in the agent, so it is not a transcript yet. Both the
 * loader (which decides whether to read the recorder's fallback) and the
 * restore gate (which decides whether to replay) ask this one question.
 */

/** Whether a transcript already holds an assistant answer. */
export function hasAssistantRow(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((row) => {
    const role = (row as { role?: unknown } | null)?.role;
    return role === 'ai' || role === 'assistant';
  });
}
