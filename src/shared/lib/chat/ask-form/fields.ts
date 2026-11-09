/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The field drafts `ask-form/index.ts` collects while walking a form, and the
 * turn from drafts to the questions the card draws.
 *
 * The question precedence is omp's `fieldQuestions`: the control's own label,
 * else the text block right before it, else its `<fieldset>` legend, else a lone
 * option's label, else the control name. A radio/checkbox group of two or more
 * also gains the `Other (type your own)` row omp's fallback appends, because the
 * card previews the rows the user will actually be offered.
 */

import type { AskOption, AskQuestion } from '@/shared/lib/chat/ask-form/types';
import { oneLine } from '@/shared/lib/chat/ask-form/tokens';

/** The "Other" row omp's field-by-field fallback appends to a choice list. */
const OTHER_LABEL = 'Other (type your own)';
const OTHER_IN_OPTIONS = /^\s*other\b/i;

export interface DraftOption {
  value: string;
  label: string;
  checked: boolean;
  disabled: boolean;
}

export interface DraftField {
  name: string;
  kind: 'choice' | 'text';
  multi: boolean;
  select: boolean;
  label: string;
  options: DraftOption[];
  /** Text field only. */
  value: string;
  multiline: boolean;
  /** Caption in force when the field appeared, and its section's legend. */
  caption: string;
  section: string;
}

/** Named fields, in document order, as the questions the card renders. */
export function toQuestions(fields: DraftField[]): AskQuestion[] {
  const questions: AskQuestion[] = [];
  for (const field of fields) {
    if (!field.name) continue;
    const lone = field.kind === 'choice' && field.options.length === 1 ? oneLine(field.options[0].label) : '';
    const question = oneLine(field.label) || field.caption || field.section || lone || field.name;
    const options: AskOption[] = field.options.map((option) => ({
      label: option.label || option.value,
      value: option.value,
    }));
    if (
      field.kind === 'choice' &&
      !field.select &&
      field.options.length >= 2 &&
      !field.options.some((option) => OTHER_IN_OPTIONS.test(option.label))
    ) {
      options.push({ label: OTHER_LABEL });
    }
    const checked = field.options.findIndex((option) => option.checked);
    questions.push({
      id: field.name,
      question,
      options,
      multi: field.multi,
      kind: field.kind,
      recommended: field.kind === 'choice' && !field.multi && checked >= 0 ? checked : undefined,
    });
  }
  return questions;
}
