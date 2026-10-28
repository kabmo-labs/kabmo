/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A `todo` init-list entry that ended up recorded as a TASK.
 *
 * omp's schema wants `list: [{ phase, items: string[] }]`. A model routinely
 * sends the same shape under the wrong key — `items: [{ phase, items }, …]` —
 * and the runtime stringifies each nested object rather than rejecting the
 * call, so the phase object lands in `details.phases[].tasks[].content` (and in
 * the summary text) as one JSON blob. Verified on a real session: the model's
 * five intended phases were recorded as five `Tasks` entries whose content is
 * the literal text `{"phase":"Fondasi auth server","items":[…]}`, and omp's own
 * HUD reads the same blob back out of the transcript.
 *
 * The blob is therefore real data, not a display artifact, and every reader
 * that shows a task has to decide what to do with it. This module is that
 * decision for the chat timeline's tool card: a content that IS an init-list
 * entry is drawn as the phase it names, instead of as JSON. The check is
 * deliberately strict — the whole string must be the object, with a string
 * `phase` and a non-empty array of string `items` — so a task that merely
 * mentions JSON is left alone.
 */

import { isRecord } from '@/shared/lib/util/guards';

export interface NestedPhaseEntry {
  phase: string;
  items: string[];
}

/** The init-list entry a task content encodes, or undefined when it is prose. */
export function parseNestedPhaseEntry(content: string): NestedPhaseEntry | undefined {
  const trimmed = content.trim();
  // Cheap guard first: JSON.parse on every task text would be the only reason
  // this module ever shows up in a timeline profile.
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const { phase, items } = parsed;
  if (typeof phase !== 'string' || phase.trim() === '') return undefined;
  if (!Array.isArray(items) || items.length === 0) return undefined;
  if (!items.every((item) => typeof item === 'string')) return undefined;

  return { phase: phase.trim(), items: items as string[] };
}

/**
 * Drop the trailing status annotation omp's summary appends after a task's
 * content (`(in progress)`, `(dropped)`, `(blocked: …)`), so a content that is
 * itself a JSON object is still recognisable behind it.
 */
export function stripTrailingStatusNote(text: string): string {
  return text.replace(/\s*\((?:in progress|dropped|blocked(?::[^()]*)?)\)\s*$/i, '').trim();
}
