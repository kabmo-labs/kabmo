/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One-line labels for a subagent roster entry.
 *
 * A delegated assignment is a task prompt, not a sentence. The wire carries it
 * twice: `assignment` is the document the caller wrote, and `task` is that same
 * document wrapped by the task tool's template ("Complete assignment
 * thoroughly:" followed by `# Target` / `# Change` / `# Acceptance` sections).
 * Rendering either verbatim in a 268px sidebar row would spend the whole row on
 * the template's lead-in, so a row shows the Target section's headline — the
 * one line that says what the agent is for.
 *
 * The two surfaces differ only in what they append to the identity:
 *   roster row  →  `id (agent): target`
 *   banner      →  `id (agent:modelRole)`
 */

import type { SubagentInfo } from '@/shared/types/omp/subagent';

/** Any markdown heading — the boundary between prompt sections. */
const HEADING_RE = /^#{1,6}\s+\S/;
/** The section the task prompt template mandates as the assignment's summary. */
const TARGET_HEADING_RE = /^#{1,6}\s+target\s*:?\s*$/i;
/** The task template's own lead-in; it says nothing about the assignment. */
const LEAD_IN_RE = /^complete (the )?assignment\b/i;

/** First line of `lines` that has content, trimmed. */
function firstLine(lines: string[]): string | undefined {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * The headline of a delegated assignment: the first line of its `# Target`
 * section, falling back to the prompt's own first prose line when there is no
 * such section (or it is empty).
 */
export function assignmentTarget(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = text.split('\n');
  const headingAt = lines.findIndex((line) => TARGET_HEADING_RE.test(line.trim()));
  if (headingAt !== -1) {
    // Bounded by the next heading: an empty Target section must not promote the
    // Change/Acceptance prose that follows it into the headline.
    const body = lines.slice(headingAt + 1);
    const nextHeading = body.findIndex((line) => HEADING_RE.test(line.trim()));
    const headline = firstLine(nextHeading === -1 ? body : body.slice(0, nextHeading));
    if (headline) return headline;
  }
  // No Target section, or an empty one: the prompt's first prose line. Headings
  // are skipped because a section name is not a summary of the assignment.
  return firstLine(lines.filter((line) => {
    const trimmed = line.trim();
    return !HEADING_RE.test(trimmed) && !LEAD_IN_RE.test(trimmed);
  }));
}

/** `id (agent:modelRole)`, or `id (agent)` when no role was recorded. Live
 *  snapshots carry the role on `progress`; history entries carry it top-level,
 *  because the on-disk fold records it from the parent's task toolResult rather
 *  than from a progress frame. */
export function subagentHeaderTitle(subagent: SubagentInfo): string {
  const role = subagent.modelRole ?? subagent.progress?.modelRole;
  return role
    ? `${subagent.id} (${subagent.agent}:${role})`
    : `${subagent.id} (${subagent.agent})`;
}

/** `id (agent): target` — the roster row's one-line label. The description is
 *  the fallback for entries whose assignment text never reached the roster. */
export function subagentRowLabel(subagent: SubagentInfo): string {
  const target = assignmentTarget(subagent.task)
    ?? assignmentTarget(subagent.assignment)
    ?? subagent.description;
  const identity = `${subagent.id} (${subagent.agent})`;
  return target ? `${identity}: ${target}` : identity;
}
