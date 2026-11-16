/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Answer bookkeeping shared by the grouped ask form: what the user picked, the
 * frame row that pick names, and the rows it is drawn as.
 *
 * omp compares a response against the labels IT offered — decorated with
 * ` (Recommended)`, `Other (type your own)` and the multi-select action row — so
 * the picked label is always mapped through the live frame's own list. Drawing
 * the answer is the inverse rule: a single choice sent one row, and the card
 * must not print a typed draft beside it as if both went out.
 */

import type { AskAnswer, AskQuestion } from '@/shared/lib/chat/ask-form/types';
import { isOtherOption } from '@/shared/lib/chat/ask-questions';

export interface Pick {
  selected: string[];
  text: string;
}

/** `✓ Done selecting` / `Done selecting` — the row that ends a multi pick. */
export const DONE_ROW = /\bdone\b/i;

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The frame's own row for a picked label, including omp's decorations. */
export function optionForLabel(options: string[], wanted: string | undefined): string | undefined {
  if (!wanted) return undefined;
  const needle = normalize(wanted);
  return (
    options.find((option) => normalize(option) === needle) ??
    options.find((option) => !isOtherOption(option) && normalize(option).startsWith(`${needle} (`)) ??
    options.find((option) => !isOtherOption(option) && normalize(option).startsWith(needle))
  );
}

/** The rows an answer is drawn as: omp's recorded one, else the local pick. */
export function partsFor(question: AskQuestion, pick: Pick | undefined, answer: AskAnswer | null): string[] {
  if (answer) return [...answer.selectedOptions, ...(answer.customInput ? [answer.customInput] : [])];
  if (!pick) return [];
  const text = pick.text.trim();
  if (question.multi === true) return [...pick.selected, ...(text ? [text] : [])];
  if (question.kind === 'text') return text ? [text] : [];
  const selected = pick.selected[0];
  return selected ? [selected] : text ? [text] : [];
}
