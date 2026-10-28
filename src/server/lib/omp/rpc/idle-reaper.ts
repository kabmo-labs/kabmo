/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The idle reclaim for one omp child.
 *
 * A wrapper keeps a process alive for as long as it is doing something and
 * reclaims it after a quiet window — but "doing something" is a question only
 * the wrapper can answer (a running turn, a parked approval dialog, a live
 * subagent), so the decision is a callback and this object owns only the clock.
 *
 * Two rules are load-bearing:
 *
 *  - **every frame defers the deadline**, which is why `reset` is called from
 *    the frame path and not from the command path alone: a long tool call emits
 *    no commands but plenty of frames;
 *  - **the deferral is coalesced** (`COALESCE_MS`). A streaming turn emits
 *    hundreds of frames a second, and re-arming a timer on each one is pure
 *    churn — the deadline only has to move once per quiet period.
 */

/** Frames arrive in bursts; re-arming the timer inside one is wasted work. */
const COALESCE_MS = 5000;

export class IdleReaper {
  readonly timeoutMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #lastReset = 0;
  readonly #onIdle: () => boolean;

  constructor(timeoutMs: number, onIdle: () => boolean) {
    this.timeoutMs = timeoutMs;
    this.#onIdle = onIdle;
  }

  /** Push the deadline back. `force` bypasses the coalescing window, for a
   *  caller that just learned the session is busy again and wants the timer
   *  re-armed from now rather than from the last frame. */
  reset(force = false): void {
    const now = Date.now();
    if (!force && this.#timer && now - this.#lastReset < COALESCE_MS) return;
    this.#lastReset = now;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      // A false answer means the session turned busy while the timer ran;
      // re-arm from now rather than waiting for the next frame to notice.
      if (!this.#onIdle()) this.reset(true);
    }, this.timeoutMs);
  }

  /** Cancel without reclaiming (teardown, an explicit destroy). */
  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
