/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tint a session row wears while it is the row the user is acting on.
 *
 * Two states share it on purpose: a batch-selected row and a row whose action
 * menu is open. Both answer the same question — "which row is this action
 * about?" — and a second tint for the menu would make one question look like
 * two. The ring is what survives a palette where `bg-ink/10` is nearly
 * invisible, and it is the same pair the batch selection already used.
 *
 * One constant for all three rows (modern, classic, phone): the menu-open cue
 * is a fact about the row, not about a chrome.
 */
export const SESSION_ROW_ATTENTION_CLASS = 'bg-ink/10 text-ink ring-1 ring-inset ring-ink/20';
