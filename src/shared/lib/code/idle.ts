/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Run work when the main thread is next free.
 *
 * Tokenizing a tool card's code is the expensive half of expanding it — measured
 * at 730–1484 ms on a throttled phone for a `read`/`grep` card — and running it
 * inside the render that a tap scheduled put all of that in the tap's own task:
 * the card appeared only after the grammar had walked every line. Deferring it
 * costs one plain-text frame and moves the work out of the interaction.
 *
 * `requestIdleCallback` is the browser's own "nothing else is waiting" signal;
 * the timeout is a FLOOR on latency rather than a budget, so a busy page still
 * paints the colour within a quarter second. Runtimes without it (happy-dom,
 * older Safari) fall back to the next macrotask.
 */

const IDLE_TIMEOUT_MS = 250;

type IdleHost = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Schedule `run`; the returned function cancels it. */
export function scheduleIdle(run: () => void, timeoutMs: number = IDLE_TIMEOUT_MS): () => void {
  const host = globalThis as unknown as IdleHost;
  if (typeof host.requestIdleCallback === 'function') {
    const handle = host.requestIdleCallback(run, { timeout: timeoutMs });
    return () => host.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(run, 0);
  return () => clearTimeout(handle);
}
