/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reads the answers out of an `ask` tool result.
 *
 * The 18.18.3 form shape records them in `details.answers[]` — `{ name,
 * question, answer }` — and prints the submitted data as JSON in the result
 * text; the older tool returned `details.results[]` for a multi-question ask
 * and bare answer fields for a single-question one, with `id: answer` prose as
 * the fallback. All three are read because persisted sessions keep the old
 * shapes, and `details` is dropped by the live `tool_execution_end` frame on
 * some builds, which is what the text fallback exists for.
 */

import type { ToolCallData } from '@/shared/types';
import type { AskAnswer, AskQuestion } from '@/shared/lib/chat/ask-form/types';
import { isAskSettled, normalizeAskText } from '@/shared/lib/chat/ask-questions';

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
 * of a settled result every path carries. The form shape prints the submitted
 * data as JSON after a marker line; the older tool named each answer by
 * question id (`language: Python`) or drew a single sentence for a one-question
 * ask.
 */
/** The form result's prose: the submitted JSON is the last `{…}` in the text. */
const FORM_RESULT = /(?:User answers:|submitted the form's current values:)[\s\S]*?(\{[\s\S]*\})\s*$/;

function parseAskOutputAnswers(output: string, questions: AskQuestion[]): (AskAnswer | null)[] {
  const answers = questions.map((): AskAnswer | null => null);
  const text = output.trim();
  if (!text) return answers;

  const form = FORM_RESULT.exec(text);
  if (form) {
    try {
      const data = JSON.parse(form[1]) as Record<string, unknown>;
      const timedOut = text.startsWith('No answer before the timeout');
      for (const [name, value] of Object.entries(data)) {
        const index = questions.findIndex((question) => question.id === name);
        if (index >= 0) answers[index] = { ...fromFormData(questions[index], value), timedOut };
      }
      return answers;
    } catch {
      // Not the form's JSON; the prose shapes below still get a chance.
    }
  }

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
 * The 18.18.3 result carries `details.answers[]` — one row per named control,
 * `{ name, question, answer }` — with `answer` rendered the way omp's own
 * `formAnswers` does: a picked option by its LABEL, `Other: <typed>` for free
 * text, and ", "-joined labels for a checkbox group. Alignment is by control
 * name, falling back to the question text.
 */
const OTHER_ANSWER = /^Other:\s*([\s\S]*)$/i;

function fromFormAnswer(question: AskQuestion, answer: string): AskAnswer {
  if (question.kind === 'text') return { selectedOptions: [], customInput: answer.trim() || undefined };
  const parts = question.multi ? answer.split(', ') : [answer];
  const selectedOptions: string[] = [];
  let customInput: string | undefined;
  for (const part of parts) {
    const other = OTHER_ANSWER.exec(part.trim());
    if (other) customInput = other[1].trim() || undefined;
    else if (part.trim()) selectedOptions.push(part.trim());
  }
  return { selectedOptions, customInput };
}

/** Answers recovered from the raw form data in the tool's text, `{ name: value }`. */
function fromFormData(question: AskQuestion, value: unknown): AskAnswer {
  if (question.kind === 'text') {
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    return { selectedOptions: [], customInput: text || undefined };
  }
  const raw = Array.isArray(value) ? value.map((entry) => String(entry)) : value === undefined ? [] : [String(value)];
  const selectedOptions: string[] = [];
  const typed: string[] = [];
  for (const entry of raw) {
    const label = question.options.find((option) => option.value === entry)?.label;
    if (label) selectedOptions.push(label);
    else if (entry) typed.push(entry);
  }
  return { selectedOptions, customInput: typed.length > 0 ? typed.join(', ') : undefined };
}

/**
 * Answers recorded in an `ask` tool result, positionally aligned with
 * `questions`. The form shape records them in `details.answers[]`; the older
 * tool returned `details.results[]` for a multi-question ask and the bare
 * answer fields for a single-question one. The rendered text backs both up.
 */
export function parseAskResult(tool: ToolCallData, questions: AskQuestion[]): (AskAnswer | null)[] {
  const answers = questions.map((): AskAnswer | null => null);
  if (questions.length === 0) return answers;

  const details = tool.details ?? {};
  const formAnswers = Array.isArray(details.answers) ? (details.answers as Record<string, unknown>[]) : null;
  if (formAnswers && formAnswers.length > 0) {
    const timedOut = details.timedOut === true;
    for (const row of formAnswers) {
      if (!row || typeof row !== 'object') continue;
      const name = typeof row.name === 'string' ? row.name : '';
      let index = name ? questions.findIndex((question) => question.id === name) : -1;
      if (index === -1 && typeof row.question === 'string') {
        const title = normalizeAskText(row.question);
        index = questions.findIndex((question) => normalizeAskText(question.question) === title);
      }
      if (index === -1) continue;
      const answer = typeof row.answer === 'string' ? row.answer : '';
      answers[index] = { ...fromFormAnswer(questions[index], answer), timedOut };
    }
    return answers;
  }

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
