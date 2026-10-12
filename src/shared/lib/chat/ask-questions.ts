/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure helpers for omp's `ask` tool: read its `questions` payload, pair the
 * per-question dialogs omp raises for them back to the question they belong to,
 * and read the recorded answers out of the tool result.
 *
 * The pairing is load-bearing, and there are TWO shapes to pair against.
 * `configureChild` opts the child into the rich dialog with
 * `set_ask_dialog {enabled:true}`, so omp's `AskTool` takes its `askDialog`
 * path and a multi-question ask arrives as ONE frame (`method:"ask"`) carrying
 * every question — matched by the question IDS it shares with the tool call's
 * arguments, which is what `ask-frames.ts` does.
 *
 * The per-question loop is still reachable (a host that never opted in, or a
 * build without the command), and there a multi-question ask reaches the
 * chamber as ONE blocking `select` frame per question, in order. That frame
 * carries the question as its `title` (plus a ` (2/3)` progress suffix and a
 * `(2 selected) ` prefix for multi-select questions), which is what lets the
 * inline card put each frame back on the question it asked. Both shapes must
 * keep working: the frame-ownership split knows each one.
 */

import type { ToolCallData } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';

export interface AskOption {
  label: string;
  description?: string;
  preview?: string;
}

export interface AskQuestion {
  id?: string;
  /** Short chip omp shows above the question ("Authentication"). */
  header?: string;
  question: string;
  options: AskOption[];
  multi: boolean;
  /** Index of the option omp marks ` (Recommended)`. */
  recommended?: number;
}

export interface AskAnswer {
  selectedOptions: string[];
  customInput?: string;
  /** omp auto-selected the answer after `ask.timeout` elapsed. */
  timedOut?: boolean;
}

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
 * The `questions` array from an `ask` tool call's arguments. Empty when the tool
 * is not an ask call or its arguments were truncated — callers fall back to the
 * raw arguments/output rendering in that case.
 */
export function parseAskQuestions(tool: ToolCallData): AskQuestion[] {
  const input = tool.input;
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : null;
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
    });
  }

  return questions;
}

function readAnswer(row: Record<string, unknown>): AskAnswer {
  return {
    selectedOptions: Array.isArray(row.selectedOptions)
      ? row.selectedOptions.filter((value): value is string => typeof value === 'string')
      : [],
    customInput: typeof row.customInput === 'string' && row.customInput ? row.customInput : undefined,
    timedOut: row.timedOut === true,
  };
}

/** One `<id>: <answer>` line of a multi-question result. */
const ANSWER_LINE = /^([\w.-]+):\s*(.+)$/;
/** The single-question result's two prose shapes. */
const SELECTED_LINE = /^User selected:\s*(.+)$/m;
const CUSTOM_LINE = /^User provided custom input:\s*([\s\S]+)$/m;

/** `value` as omp renders it: a quoted string is typed input, a bare one is a
 *  picked label (comma-joined when the question allows several). */
function toAnswer(value: string, multi: boolean): AskAnswer {
  const text = value.trim();
  if (/^"[\s\S]*"$/.test(text)) return { selectedOptions: [], customInput: text.slice(1, -1) };
  const labels = multi && text.includes(', ') ? text.split(', ') : [text];
  return { selectedOptions: labels.map((label) => label.trim()).filter(Boolean) };
}

/**
 * Answers recovered from the tool's rendered text, used when `details` never
 * reached this client. `details` is the richer source, but it is dropped by the
 * live `tool_execution_end` frame on some omp builds; the text is the one part
 * of a settled result every path carries, and it names each answer by question
 * id (`language: Python`) or as a single sentence for a one-question ask.
 */
function parseAskOutputAnswers(output: string, questions: AskQuestion[]): (AskAnswer | null)[] {
  const answers = questions.map((): AskAnswer | null => null);
  const text = output.trim();
  if (!text) return answers;

  const byId = new Map<string, AskAnswer>();
  for (const line of text.split('\n')) {
    const match = ANSWER_LINE.exec(line.trim());
    if (match) byId.set(match[1], toAnswer(match[2], questions.some((question) => question.multi)));
  }
  if (byId.size > 0) {
    const ordered = [...byId.values()];
    for (let index = 0; index < questions.length; index += 1) {
      // The question id is the key omp prints; position is what is left when a
      // payload carries no ids at all (omp requires them, so this is defensive).
      const id = questions[index].id;
      answers[index] = (id ? byId.get(id) : undefined) ?? ordered[index] ?? null;
    }
    return answers;
  }

  const selected = SELECTED_LINE.exec(text);
  if (selected) {
    answers[0] = toAnswer(selected[1], questions[0].multi);
    return answers;
  }
  const custom = CUSTOM_LINE.exec(text);
  if (custom) {
    answers[0] = { selectedOptions: [], customInput: custom[1].trim() };
    return answers;
  }
  if (questions.length === 1 && !text.includes('\n')) {
    answers[0] = { selectedOptions: [text] };
  }
  return answers;
}

/**
 * Answers recorded in an `ask` tool result, positionally aligned with
 * `questions`. omp returns `details.results[]` for a multi-question ask and the
 * bare answer fields for a single-question one; the rendered text backs both up.
 */
export function parseAskResult(tool: ToolCallData, questions: AskQuestion[]): (AskAnswer | null)[] {
  const answers = questions.map((): AskAnswer | null => null);
  if (questions.length === 0) return answers;

  const details = tool.details ?? {};
  const results = Array.isArray(details.results) ? (details.results as Record<string, unknown>[]) : null;
  if (results) {
    for (let index = 0; index < answers.length; index += 1) {
      const row = results[index];
      if (row && typeof row === 'object') answers[index] = readAnswer(row);
    }
    return answers;
  }

  if (typeof details.selectedOptions !== 'undefined' || typeof details.customInput === 'string') {
    answers[0] = readAnswer(details);
    return answers;
  }

  // A failed/cancelled ask answers nothing; its text is the reason, which would
  // otherwise read as an answer for whichever id its first sentence names.
  if (isAskSettled(tool) || tool.isError) return answers;

  return parseAskOutputAnswers(typeof tool.output === 'string' ? tool.output : '', questions);
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
  const titles = questions.map((question) => normalizeAskText(question.question));

  let cursor = 0;
  for (const frame of frames) {
    const title = typeof frame.title === 'string' ? normalizeAskText(frame.title) : '';
    const index = titles.indexOf(title);
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
