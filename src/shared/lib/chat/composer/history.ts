/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's prompt recall: which commands carry the operator's own words,
 * and how the ArrowUp / ArrowDown cursor moves through the list.
 *
 * Shared because both ends need the same vocabulary: the server records a
 * prompt when one of these commands enters, and the client walks the list it
 * gets back. The cursor rules are pure so the boundaries (no wrap at either
 * end, the draft restored past the newest entry) are testable without a
 * textarea.
 */

/**
 * Commands whose `message` is text the operator typed in the composer.
 *
 * `prompt` is the ordinary send; `steer` and `follow_up` are the mid-run
 * variants (Ctrl+Enter / Send Now); `abort_and_prompt` is the legacy steer the
 * older clients still post. Everything else — `set_model`, `abort`, a mode
 * request — carries no prompt.
 */
export const RECALLABLE_COMMAND_TYPES: Record<string, true> = {
  prompt: true,
  steer: true,
  follow_up: true,
  abort_and_prompt: true,
};

export type HistoryDirection = 'up' | 'down';

/**
 * The next cursor in a NEWEST-FIRST list, or `null` when the key must do
 * nothing.
 *
 * `-1` is the draft the operator was typing: ArrowUp from there enters the
 * list at its newest entry, ArrowDown from there is a plain caret move, and
 * ArrowDown from the oldest entry walks back to the draft. Neither end wraps.
 */
export function stepHistoryCursor(length: number, cursor: number, direction: HistoryDirection): number | null {
  if (length <= 0) return null;
  if (direction === 'up') return cursor + 1 < length ? cursor + 1 : null;
  return cursor > -1 ? cursor - 1 : null;
}

/**
 * Whether ArrowUp may recall instead of moving the caret: the caret has to be
 * on the FIRST line, so a multi-line draft keeps its normal arrow behavior.
 */
export function canRecallUp(text: string, caret: number | null): boolean {
  const position = caret ?? text.length;
  return !text.slice(0, position).includes('\n');
}

/** The mirror rule for ArrowDown: the caret has to be on the LAST line. */
export function canRecallDown(text: string, caret: number | null): boolean {
  const position = caret ?? text.length;
  return !text.slice(position).includes('\n');
}
