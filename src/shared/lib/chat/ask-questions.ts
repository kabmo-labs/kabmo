/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Pure helpers for omp's `ask` tool: read the questions it asked and pair the
 * per-question dialogs omp raises for them back to the question they belong to.
 * The answers live in `ask-results.ts`.
 *
 * TWO payload shapes reach this file. Since 18.18.3 the tool takes ONE
 * `{ html }` form (`ask-form/` parses it into questions) and the RPC host
 * walks its named fields one dialog at a time — a `select`/`input`/`editor`
 * per field, with the question as its title. Before that, the tool took
 * `questions[]`, and a host that opted in with `set_ask_dialog` got every
 * question in ONE `method:"ask"` frame matched by question ids. Persisted
 * sessions keep the old shape, so both are still read; `set_ask_dialog` now
 * only reaches extensions and omp's ratchet, not this tool.
 *
 * The title pairing is load-bearing: omp decorates a select's title with a
 * `(2 selected) ` prefix and a ` (2/3)` progress suffix, and a rejected text
 * answer re-asks as `question (Enter a number)`. What is left is what lets the
 * inline card put each frame back on the question it asked.
 */

import type { ToolCallData } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { parseAskForm } from '@/shared/lib/chat/ask-form';
import type { AskOption, AskQuestion } from '@/shared/lib/chat/ask-form/types';

/** The free-text escape hatch omp appends to every question's option list. */
const OTHER_OPTION = /^other\b/i;
/** Trailing ` (2/3)` omp adds while looping over several questions. */
const PROGRESS_SUFFIX = /\s+\(\d+\s*\/\s*\d+\)$/;
/** Leading `(2 selected) ` omp prepends to a multi-select question's title. */
const SELECTED_COUNT_PREFIX = /^\(\d+\s+selected\)\s*/;

/** True for the literal "Other (type your own)" row, which is a prompt to type
 *  an answer rather than an answer itself. */
export function isOtherOption(label: string): boolean {
  return OTHER_OPTION.test(label.trim());
}

/** Normalized question text, with the decorations omp adds to a live dialog
 *  title stripped, so a frame can be matched against the question that raised it. */
export function normalizeAskText(value: string): string {
  return value
    .replace(SELECTED_COUNT_PREFIX, '')
    .replace(PROGRESS_SUFFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Index of the question a dialog title names.
 *
 * Exact after the decorations are stripped, else the longest question the
 * title starts with followed by ` (` — the shape omp's field-by-field walk
 * uses for a rejected text answer (`question (Enter a number)`). Longest wins
 * so `Pick a colour (light)` is not captured by an `Pick a colour` beside it.
 */
export function askQuestionForTitle(questions: AskQuestion[], title: unknown): number {
  if (typeof title !== 'string') return -1;
  const needle = normalizeAskText(title);
  if (!needle) return -1;
  let best = -1;
  let longest = 0;
  for (let index = 0; index < questions.length; index += 1) {
    const candidate = normalizeAskText(questions[index].question);
    if (!candidate || candidate.length <= longest) continue;
    if (needle === candidate || needle.startsWith(`${candidate} (`)) {
      best = index;
      longest = candidate.length;
    }
  }
  return best;
}

function readOption(raw: unknown): AskOption | null {
  if (typeof raw === 'string') {
    const label = raw.trim();
    return label ? { label } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  if (!label) return null;
  return {
    label,
    description: typeof record.description === 'string' ? record.description : undefined,
    preview: typeof record.preview === 'string' ? record.preview : undefined,
  };
}

/** True for a tool call that is omp's `ask` tool. */
export function isAskToolCall(tool: ToolCallData): boolean {
  const name = typeof tool.name === 'string' && tool.name ? tool.name : tool.type;
  return name === 'ask' || tool.title === 'ask';
}

/**
 * True for an ask omp has given up on — its dialog was withdrawn (a validation
 * failure, an abort), so no live frame can belong to it and its card renders no
 * control. Deliberately NOT `success`: a session reloaded mid-ask reads its
 * still-blocking call back from the JSONL as `success`, since omp writes no
 * result until the question is answered, and that card must stay answerable.
 *
 * Two modules must agree on this (the frame-ownership split and the card
 * itself), which is why it is not an inline comparison at either.
 */
export function isAskSettled(tool: ToolCallData): boolean {
  return tool.status === 'error' || tool.status === 'aborted' || tool.status === 'skipped';
}

/**
 * The questions of an `ask` tool call: parsed from its `html` form (18.18.3+),
 * else from the `questions` array an older call carried. Empty when the tool is
 * not an ask call or its arguments were truncated — callers fall back to the
 * raw arguments/output rendering in that case.
 */
export function parseAskQuestions(tool: ToolCallData): AskQuestion[] {
  const input = tool.input;
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : null;
  if (record && typeof record.html === 'string') {
    const fromForm = parseAskForm(record.html);
    if (fromForm.length > 0) return fromForm;
  }
  const raw = record && Array.isArray(record.questions) ? record.questions : [];
  const questions: AskQuestion[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const question = entry as Record<string, unknown>;
    const text = typeof question.question === 'string' ? question.question.trim() : '';
    if (!text) continue;
    questions.push({
      id: typeof question.id === 'string' ? question.id : undefined,
      header: typeof question.header === 'string' && question.header.trim() ? question.header.trim() : undefined,
      question: text,
      options: Array.isArray(question.options)
        ? question.options.map(readOption).filter((option): option is AskOption => option !== null)
        : [],
      multi: question.multi === true,
      recommended: typeof question.recommended === 'number' ? question.recommended : undefined,
      kind: 'choice',
    });
  }

  return questions;
}

/**
 * Bucket the ask's dialogs by question index.
 *
 * Assignment follows omp's own order rather than pure title matching: a frame
 * whose title names a question moves the cursor onto it, and any other frame
 * (the `editor`/`input` dialog omp opens after "Other (type your own)") belongs
 * to whichever question was last named. A title that names an EARLIER question
 * is ignored — omp walks the questions forward and never re-asks one, so a
 * repeat can only be a multi-select re-render of the question already in hand.
 */
export function groupAskFrames(
  questions: AskQuestion[],
  frames: ExtensionUiDialogRequest[],
): ExtensionUiDialogRequest[][] {
  const groups = questions.map((): ExtensionUiDialogRequest[] => []);
  if (questions.length === 0) return groups;

  let cursor = 0;
  for (const frame of frames) {
    const index = askQuestionForTitle(questions, frame.title);
    if (index > cursor) {
      cursor = index;
    } else if (
      index === -1 &&
      frame.method === 'select' &&
      groups[cursor].some((held) => held.method === 'select') &&
      cursor + 1 < groups.length
    ) {
      // Title matching is the authority, but a question is asked by exactly one
      // `select` — a second one that matches nothing is the NEXT question with
      // decorations this build does not know about, not a repeat.
      cursor += 1;
    }
    groups[cursor].push(frame);
  }

  return groups;
}
