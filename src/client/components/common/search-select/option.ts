/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** One option: the value stored, and what a reader sees. */
export interface SearchSelectOption {
  value: string;
  label: string;
  /** Shown under the label in the list, not on the trigger. */
  hint?: string;
  /** Rows under one heading stay in the order they were given. */
  group?: string;
  /** Offered but not pickable — a format whose tool is not installed. */
  disabled?: boolean;
}
