/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared field styling for the speech sections.
 *
 * One place because the endpoint, the voice picker and the key field are three
 * files: a second copy is how one input grows 2px taller than its neighbour.
 */
export const INPUT_CLASS =
  'w-full rounded-md border border-ink/20 bg-paper px-2 py-1.5 font-mono text-[11px] text-ink outline-none transition-colors placeholder:text-ink/30 focus:border-ink/50 disabled:opacity-50';

export const CARD_CLASS = 'rounded-lg border border-ink/15 bg-paper px-3.5 py-3';
