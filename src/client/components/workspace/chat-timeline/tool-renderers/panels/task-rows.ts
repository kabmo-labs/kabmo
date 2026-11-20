/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rows a `task` card draws, from either producer's shape.
 *
 * omp sends `input.tasks[]` — one entry per delegated worker, with `name` and
 * `agent`. ACP adapters send ONE child in a different spelling: grok's
 * `{description, prompt, subagent_type}` and cursor's `{_toolName:"task"}` with
 * the words only in the title. The panel judged `rows.length === 0 && !output &&
 * !context` and returned null, so a delegation from an ACP agent rendered as an
 * EMPTY card — the call existed in the transcript and showed nothing.
 *
 * One normalizer keeps both shapes drawing the same card, and a missing
 * `subagent_type` is reported as absent rather than invented as `scout`.
 */

export interface TaskRowShape {
  name: string;
  agent?: string;
  task?: string;
}

/** The delegated child a non-omp adapter named, or null when the call carries
 *  no child at all (an omp `task` with an empty list is not a delegation). */
export function acpDelegationRow(
  input: Record<string, unknown> | undefined,
  intent: string | undefined,
): TaskRowShape | null {
  if (!input) return null;
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  const subagent = typeof input.subagent_type === 'string' ? input.subagent_type.trim() : '';
  const wrapped = input._toolName === 'task';
  const task = description || prompt;
  if (!task && !wrapped && !subagent) return null;
  const label = task || intent?.trim() || 'Subagent';
  return {
    // The clamped first line is the card's row label; the full text is the
    // brief, which is what the operator needs to approve the delegation.
    name: label.split('\n')[0].slice(0, 80),
    ...(subagent ? { agent: subagent } : {}),
    ...(task ? { task } : {}),
  };
}
