/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turn-matching helpers shared by Kabmo chat loader and the in-place
 * rewind endpoint: identifying raw composer input and deciding whether a
 * JSONL-derived user turn and a stored DB-copy turn are the same request
 * (omp rewrites delivered prompts, so equality is not enough).
 *
 * The jump rail also reads from here: it lists user turns of the FULL session
 * (`/api/chat/:id/turns`) and from the mounted window, and both build the same
 * tooltip preview, so the truncation length is shared rather than duplicated.
 */

/** Longest prompt excerpt a rail tooltip renders. */
export const TURN_PREVIEW_CHARS = 220;

/** Whether a stored content string is raw composer input (slash command or
 *  @mention) rather than the prompt omp actually delivered. */
export function isRawComposerInput(content: string): boolean {
  return /^\s*\//.test(content) || /(^|\s)@[A-Za-z0-9_-]+/.test(content);
}

/** Whether a JSONL-derived user turn (a) and a stored one (b) are the same
 *  request despite omp rewriting the delivered prompt. */
export function userTurnsRelate(a: string, b: string): boolean {
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  // `@agent` is delivered to omp as a task-tool delegation prompt.
  if (a.startsWith('Use the task tool to delegate this request') && /(^|\s)@[A-Za-z0-9_-]+/.test(b)) {
    return true;
  }
  // `/skill:<name> <args>`: the JSONL only records a synthesized `/skill:<name>`.
  const token = a.split(' ')[0];
  return a.startsWith('/skill:') && Boolean(token) && b.startsWith(token);
}
