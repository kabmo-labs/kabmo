/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The inputs an ACP chat holds while a turn is running.
 *
 * ACP has no mid-turn channel of its own: `_session/steering` is omp's
 * extension, and every other agent refuses it. Without a queue here, a
 * follow-up sent while the agent was working had nowhere to go — it was either
 * dropped or answered with a refusal the operator could not act on.
 *
 * One input is dispatched as each turn closes, in arrival order, and the queue is
 * drained by `AcpTurns` itself so a queued input can never outlive the turn it
 * was written against.
 */

export interface QueuedInput {
  message: string;
  images: unknown;
}

export class TurnQueue {
  readonly #items: QueuedInput[] = [];

  push(input: QueuedInput): void {
    this.#items.push(input);
  }

  /** Take the oldest input, or undefined when none is waiting. */
  shift(): QueuedInput | undefined {
    return this.#items.shift();
  }

  get size(): number {
    return this.#items.length;
  }

  clear(): void {
    this.#items.length = 0;
  }
}
