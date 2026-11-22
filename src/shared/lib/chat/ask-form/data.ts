/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The submitted `data` object of a `form` dialog (omp 19.1.0).
 *
 * omp's RPC host now renders the `ask` tool's whole HTML form in ONE
 * `method:"form"` frame and validates the reply against the form it parsed
 * (`parseFormDialogResponse` in `modes/rpc/rpc-mode.ts`):
 *
 *  - every key must name a control of the form;
 *  - a choice value must be an option `value` the control offered (a disabled
 *    option is refused outright), or — for a radio/checkbox group that offers
 *    "Other" — ONE free-text entry;
 *  - a checkbox group or `<select multiple>` takes an ARRAY, every other
 *    choice one string;
 *  - a text control takes a string (a number is accepted for `number`/`range`);
 *  - `required` fields must carry a value, and at least one field must carry
 *    an entry at all (an empty object throws).
 *
 * This module is that contract in one place, pure and testable: the card
 * collects picks, and this turns them into the exact object omp accepts — or
 * says which question is still unanswered, so Submit can stay disabled instead
 * of sending a frame omp refuses.
 */

import type { AskQuestion } from '@/shared/lib/chat/ask-form/types';

/** What the user picked for one question, by control name. */
export interface FormPick {
  /** Option labels the user toggled on (choice controls only). */
  selected: string[];
  /** Typed answer — a text control's value, or a choice's "Other" text. */
  text: string;
}

/** One control's contribution, or the reason there is none yet. */
export interface FormAnswer {
  /** The control name (`AskQuestion.id`). */
  name: string;
  /** `string` for a single choice or text field, `string[]` for a group. */
  value: string | string[];
  /** The question that still has to be answered before this form can submit. */
  missing?: string;
}

/** Whether a question takes an array (checkbox group or multi-select). */
export function isArrayQuestion(question: AskQuestion): boolean {
  return question.multi === true && question.options.length > 1;
}

/** The option a picked label names, matching on label first and `value` second
 *  (a form may label a row differently from what it submits). */
function optionFor(question: AskQuestion, label: string): { value: string; disabled: boolean } | undefined {
  const needle = label.trim();
  const byLabel = question.options.find((option) => (option.label || option.value || '').trim() === needle);
  const found = byLabel ?? question.options.find((option) => (option.value ?? '').trim() === needle);
  return found ? { value: found.value ?? found.label, disabled: found.disabled === true } : undefined;
}

/**
 * The submitted value of one question, or `undefined` when the user has not
 * answered it.
 *
 * A choice's picks are mapped to the form's own `value` attributes — omp
 * compares against those, never the visible label — and a disabled option is
 * dropped rather than sent (omp refuses the whole frame for it).
 */
export function answerForQuestion(question: AskQuestion, pick: FormPick | undefined): string | string[] | undefined {
  const selected = pick?.selected ?? [];
  const text = pick?.text.trim() ?? '';

  if (question.kind === 'text') return text ? text : undefined;

  const values: string[] = [];
  for (const label of selected) {
    const option = optionFor(question, label);
    if (!option || option.disabled) continue;
    if (!values.includes(option.value)) values.push(option.value);
  }

  if (isArrayQuestion(question)) {
    // "Other" is an extra ENTRY in a group, never a replacement for it.
    return text ? [...values, text] : values;
  }
  // A single choice submits ONE string: the typed answer stands in for the
  // option, exactly as omp's `choiceValue` does for its "Other" row.
  if (text) return text;
  return values[0];
}

/**
 * Every question's contribution, in form order.
 *
 * A question whose control is `required` and still empty carries `missing` so
 * the card can name it; an unanswered optional control is omitted from the
 * payload (omp treats an absent entry as "nothing checked").
 */
export function formAnswers(questions: AskQuestion[], picks: Record<number, FormPick>): FormAnswer[] {
  return questions.map((question, index) => {
    const value = answerForQuestion(question, picks[index]);
    const empty = value === undefined || (Array.isArray(value) && value.length === 0);
    return {
      name: question.id ?? '',
      value: value ?? (isArrayQuestion(question) ? [] : ''),
      ...(empty && question.required === true ? { missing: question.question } : {}),
    };
  });
}

/** The `data` object to send, or the first reason the form cannot be submitted.
 *
 *  At least one entry is mandatory: omp throws on an empty object ("at least
 *  one field must carry the entry"), and a Submit that could only be refused is
 *  disabled instead. */
export function buildFormData(
  questions: AskQuestion[],
  picks: Record<number, FormPick>,
): { data: Record<string, string | string[]> } | { missing: string } {
  const answers = formAnswers(questions, picks);
  const missing = answers.find((answer) => answer.missing !== undefined);
  if (missing?.missing !== undefined) return { missing: missing.missing };

  const data: Record<string, string | string[]> = {};
  for (const answer of answers) {
    if (!answer.name) continue;
    const value = answer.value;
    if (typeof value === 'string' ? value.trim() === '' : value.length === 0) continue;
    data[answer.name] = value;
  }
  if (Object.keys(data).length === 0) return { missing: 'Answer at least one question.' };
  return { data };
}

/** Answers omp already recorded, as picks, so a reloaded card shows them. */
export function picksFromAnswers(
  questions: AskQuestion[],
  recorded: (readonly string[] | null)[],
): Record<number, FormPick> {
  const picks: Record<number, FormPick> = {};
  questions.forEach((question, index) => {
    const parts = recorded[index];
    if (!parts || parts.length === 0) return;
    const labels: string[] = [];
    const extra: string[] = [];
    for (const part of parts) {
      if (optionFor(question, part)) labels.push(part);
      else extra.push(part);
    }
    picks[index] = { selected: labels, text: extra.join(', ') };
  });
  return picks;
}
