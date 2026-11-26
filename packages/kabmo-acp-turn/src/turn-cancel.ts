/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The grace window after a local Stop.
 *
 * `session/cancel` is a notification and the agent may never answer the prompt it
 * was given, so the outstanding `session/prompt` request has to be settled
 * locally or the NEXT turn — chained behind it — never goes out. Settling it at
 * once is wrong for the opposite reason: an agent that is still finishing its
 * cancel answers a prompt that no longer exists, and its own turn boundary is
 * lost.
 *
 * This object owns the middle: it waits, then settles, and a new prompt (or a
 * second Stop) cancels the wait. The visible turn is closed separately and
 * immediately — only the CHAIN waits.
 */

const CANCEL_SETTLE_MS = 4_000;

export class CancelSettle {
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly settle: () => void,
    private readonly ms: number = CANCEL_SETTLE_MS,
  ) {}

  /** Hold the outstanding request open for the grace window. */
  arm(): void {
    this.disarm();
    const timer = setTimeout(() => {
      if (this.#timer !== timer) return;
      this.#timer = null;
      this.settle();
    }, this.ms);
    timer.unref?.();
    this.#timer = timer;
  }

  /** Settle now — a new prompt is the decision that the old turn is over. */
  flush(): void {
    if (this.#timer === null) return;
    this.disarm();
    this.settle();
  }

  /** Is the grace window still open? */
  pending(): boolean {
    return this.#timer !== null;
  }

  /** Drop the wait without settling (a Stop that queued its successor). */
  disarm(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }
}
