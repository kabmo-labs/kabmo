/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The goal token budget as a value, wherever it is typed.
 *
 * Three places accept it — the Goal dialog's field, the default in
 * Settings → Chats → Goal Mode, and the wire payload the extension parses — and
 * all three have to agree on what "no budget" means: not `0`, not `NaN`, but
 * `null`. omp refuses a non-positive budget outright, and a `0` that reached it
 * as "unlimited" would be read as "spent" by the loop's own guard.
 */
export function normalizeGoalBudget(value: unknown): number | null {
  // `Number`, not `parseInt`: "1.5" is a typo, not one token, and the Goal
  // dialog refuses it — a silent truncation here would create a goal with a
  // budget the user never wrote.
  const parsed = typeof value === 'string' ? (value.trim() === '' ? Number.NaN : Number(value.trim())) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
