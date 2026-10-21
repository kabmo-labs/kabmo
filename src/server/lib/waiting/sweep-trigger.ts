/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Something that a held prompt may be waiting on just moved."
 *
 * A one-function slot rather than a direct import, because the producer is the
 * follow-up queue's delivery path and the consumer is the waiting-prompt
 * runtime — and the runtime already imports the queue (it has to ask whether a
 * dependency still holds a queued item, and whether a delivery is armed). A
 * direct edge back would close that cycle.
 *
 * Anchored on `globalThis` for the reason the other process-wide slots are: a
 * `bun --hot` reload re-evaluates the runtime module, and a module-level binding
 * would leave the previous generation's callback installed.
 */

const SLOT = '__kabmoWaitingSweepRequest';

type SweepRequest = (delayMs: number) => void;

/** Install (or clear) the runtime's sweep request. Called by the runtime. */
export function setWaitingSweepHandler(handler: SweepRequest | null): void {
  (globalThis as unknown as Record<string, SweepRequest | null | undefined>)[SLOT] = handler;
}

/**
 * Ask the waiting runtime for a sweep. A no-op when no runtime is installed —
 * which only happens before boot finished, when there is nothing to sweep yet.
 */
export function requestWaitingSweep(delayMs = 1_600): void {
  (globalThis as unknown as Record<string, SweepRequest | undefined>)[SLOT]?.(delayMs);
}
