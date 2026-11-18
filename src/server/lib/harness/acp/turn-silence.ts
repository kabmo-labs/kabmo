/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The silence ceiling for one open ACP turn.
 *
 * ACP has no `get_state` probe: unlike omp, nothing can ask the agent "are you
 * still working?", so a turn whose agent stopped answering stays open forever —
 * `isBusy()` keeps the idle reclaim away, the process lives on, and a delegated
 * worker's coordinator waits for a result that will never come. The only
 * evidence left is silence, so this is a CEILING, not a detector: an hour with
 * no frame at all. A working agent streams token deltas or tool updates, and
 * the repo's own background-work ceiling is 10 minutes, so an hour of complete
 * silence is six times more generous than the precedent beside it.
 *
 * The clock is fed by every frame (`noteActivity`) and stopped by the turn's own
 * end, so a settled turn can never strand a later one.
 */

/** Quiet stretch after which an open turn is presumed stranded. */
export const TURN_SILENCE_MS = 60 * 60_000;

export class TurnSilence {
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #ms: number;
  readonly #onStranded: () => void;

  constructor(onStranded: () => void, ms: number = TURN_SILENCE_MS) {
    this.#onStranded = onStranded;
    this.#ms = ms;
  }

  /** (Re-)arm for the open turn. Called on every frame the agent sends. */
  arm(): void {
    this.stop();
    const timer = setTimeout(() => {
      this.#timer = null;
      this.#onStranded();
    }, this.#ms);
    // Must never keep the event loop alive on its own.
    timer.unref?.();
    this.#timer = timer;
  }

  /** The turn ended (settled, cancelled, or the session is going away). */
  stop(): void {
    clearTimeout(this.#timer ?? undefined);
    this.#timer = null;
  }
}
