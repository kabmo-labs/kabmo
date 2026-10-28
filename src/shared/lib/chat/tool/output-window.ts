/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How much of a long tool output is actually rendered.
 *
 * `MAX_OUTPUT_LINES` (1000) is a cap on how much text a panel KEEPS, not on how
 * much it should MOUNT: a 1000-line build log inside a `max-h-72` (288px) box
 * draws ~15 visible rows and 985 that no one can see, and the search panel's
 * virtualized list measured what that costs when it was done at scale (34s of
 * blocked main thread for one scroll over 19,376 mounted rows).
 *
 * The window opens on the TAIL, because a build log's answer is at its end —
 * the same end `truncateTailLines` already kept. Revealing walks upward, so
 * "show earlier" adds the lines a reader is scrolling back for without
 * discarding the ones they were reading.
 *
 * Pure and DOM-free so the policy is testable without a renderer.
 */

/** Lines shown before the reader asks for more. */
export const OUTPUT_WINDOW_INITIAL = 60;
/** Lines added per reveal. */
export const OUTPUT_WINDOW_STEP = 240;
/** Hard ceiling on mounted rows for one output block, matching MAX_OUTPUT_LINES. */
export const OUTPUT_WINDOW_MAX = 1000;

export interface OutputWindow {
  /** First rendered line index (inclusive), in the full line array. */
  start: number;
  /** Last rendered line index (exclusive). */
  end: number;
  /** Lines dropped above `start`. */
  hidden: number;
  /** True while lines above `start` can still be revealed. */
  canReveal: boolean;
}

/**
 * The slice to mount for `total` lines when `revealed` are currently shown.
 *
 * `revealed` is clamped to `[initial, OUTPUT_WINDOW_MAX]` so a caller that
 * counts up cannot mount past the ceiling, and a caller that has not counted
 * yet cannot mount everything.
 */
export function outputWindow(
  total: number,
  revealed: number,
  initial: number = OUTPUT_WINDOW_INITIAL,
): OutputWindow {
  if (total <= 0) return { start: 0, end: 0, hidden: 0, canReveal: false };
  const ceiling = Math.min(OUTPUT_WINDOW_MAX, total);
  const shown = Math.max(initial, Math.min(revealed, ceiling));
  const start = Math.max(0, total - shown);
  return { start, end: total, hidden: start, canReveal: start > 0 };
}

/**
 * Next `revealed` value after one "show earlier" press: one step up, clamped to
 * the ceiling. Returning the same number at the ceiling is what lets a caller
 * hide the button (`next === revealed`).
 */
export function revealMore(revealed: number, total: number): number {
  const ceiling = Math.min(OUTPUT_WINDOW_MAX, total);
  return Math.min(revealed + OUTPUT_WINDOW_STEP, ceiling);
}

/** True when a press of "show earlier" would add anything. */
export function canRevealMore(revealed: number, total: number): boolean {
  return revealMore(revealed, total) > revealed;
}
