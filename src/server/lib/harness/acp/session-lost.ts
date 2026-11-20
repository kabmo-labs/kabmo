/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "The agent no longer has this session."
 *
 * ACP defines no code for a lost session: an adapter answers `-32002`, or a
 * message — `session not found`, `session lock unavailable`, `Session abc not
 * found`. Whatever the spelling, the session object Kabmo holds is dead: every
 * later prompt answers the same refusal, and a chat that keeps the same process
 * can never recover.
 *
 * The recovery is the resume path that already exists — destroy this session so
 * the next command respawns the agent and `session/resume|load`s the agent's own
 * id. Recognising the failure is the whole job of this module.
 */

const LOST_SESSION_PATTERN = /\bsession\b(?:\s+\S+)?\s+not\s+found|\bsession\s+lock\s+unavailable\b|\bno\s+such\s+session\b/i;

/** The spec's "resource not found", which adapters use for a dropped session. */
const NOT_FOUND_CODE = -32002;

/** Whether a failed turn means the session is gone. */
export function isLostSession(failure: string | null | undefined, code?: unknown): boolean {
  if (code === NOT_FOUND_CODE) return true;
  return typeof failure === 'string' && LOST_SESSION_PATTERN.test(failure);
}

/** The sentence a reattaching user reads once the session was dropped for a lost
 *  agent session; the next send restores it. */
export const LOST_SESSION_NOTICE =
  'The agent no longer has this session in its context. The next message restores it from the agent\'s own history.';
