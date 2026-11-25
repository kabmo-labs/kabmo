/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `ask` card's own vocabulary, shared by the form parser
 * (`ask-form/index.ts`), the question helpers (`ask-questions.ts`) and the
 * result reader (`ask-results.ts`).
 */

export interface AskOption {
  label: string;
  description?: string;
  preview?: string;
  /** The control's `value`, when an HTML form spelled one ("Value" in JSON). */
  value?: string;
  /**
   * A checkbox/radio the `<form>` marks `checked`/`selected`. A multi-select
   * starts with these ON, and sending such a label toggles it OFF — so the UIs
   * must draw the default rather than an empty set.
   */
  checked?: boolean;
  /**
   * The `<form>` marks the option `disabled`. omp refuses a submission that
   * carries it ("carries disabled option"), so the card must not offer the row
   * and the payload builder must drop it.
   */
  disabled?: boolean;
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
  /**
   * Which control the question came from. The HTML form distinguishes a choice
   * list from a text field, and an answer's rendered text means different
   * things depending on it (`ask-form/index.ts`). Absent on the pre-18.18.3 shape,
   * where every question was a choice.
   */
  kind?: 'choice' | 'text';
  /**
   * The control carries the `required` attribute. Since omp 19.2.0 a form
   * submission that leaves it empty is still accepted (the dialog flags it and
   * sends), so nothing gates on this; it is kept for display and for the older
   * per-field walk, which does enforce it.
   */
  required?: boolean;
}

export interface AskAnswer {
  selectedOptions: string[];
  customInput?: string;
  /** omp auto-selected the answer after `ask.timeout` elapsed. */
  timedOut?: boolean;
}
