/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Watchdog for a dispatch whose turn never opened.
 *
 * The command dispatcher marks `stream` and arms `awaitingAgentStartDeadline`
 * the moment a prompt is sent, because omp may accept it and open no turn at
 * all — a builtin it runs itself, or a prompt it drops. It then relies on a
 * frame to settle that state: `agent_start` for a real run, `prompt_result` for
 * one that never started. When NO such frame ever arrives nothing settles it:
 *
 *   - `promptRunning` stays true, so `isRunning()` stays true, so the idle
 *     reaper refuses to reclaim the child and `GET /api/agent/:id` reports
 *     `busy` forever;
 *   - the `stream` row is owned by a LIVE process, so
 *     `healStaleStreamStatuses` cannot reach it either — the sidebar spinner
 *     turns until the process restarts.
 *
 * Measured shape: Kabmo's own `/kabmo-mode` extension (the composer's
 * Plan/Goal toggles) acks a bare `{success:true}`, which reads as a run.
 *
 * The deadline is the only thing that can tell this apart from a slow start,
 * and nothing was watching it. This watches it.
 *
 * The decision is a callback because "did it actually settle?" is a question
 * only the wrapper can answer — the same split as `IdleReaper`, and for the
 * same reason: this object owns only the clock.
 */

export interface AgentStartWatchdogHost {
  /** Armed by the dispatcher; cleared by any frame that settles the dispatch. */
  awaitingAgentStart: boolean;
  awaitingAgentStartDeadline: number;
  /** A real run is under way, which outranks a stale deadline. */
  streaming: boolean;
  sessionId: string;
}

export class AgentStartWatchdog {
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #host: AgentStartWatchdogHost;
  readonly #onExpired: () => void;

  constructor(host: AgentStartWatchdogHost, onExpired: () => void) {
    this.#host = host;
    this.#onExpired = onExpired;
  }

  /**
   * (Re-)arm for the pending deadline. A no-op when no dispatch is awaiting a
   * turn, so it is safe to call unconditionally after a prompt ack.
   */
  arm(): void {
    this.stop();
    if (!this.#host.awaitingAgentStart || !this.#host.sessionId) return;
    const delayMs = Math.max(0, this.#host.awaitingAgentStartDeadline - Date.now());
    this.#timer = setTimeout(() => {
      this.#timer = null;
      // A frame settled the dispatch while we waited — the deadline is no
      // longer the truth about it, and a live turn always outranks it.
      if (!this.#host.awaitingAgentStart || this.#host.streaming) return;
      this.#onExpired();
    }, delayMs);
    // Must never keep the event loop alive on its own.
    this.#timer.unref?.();
  }

  /**
   * Cancel when a frame settled the dispatch (`agent_start` cleared the
   * awaiting flag and streams; `prompt_result` cleared it too). Cancelling here
   * rather than letting the timer fire keeps a stale callback from re-reading
   * flags a LATER dispatch has since re-armed.
   */
  settleIfDone(): void {
    if (this.#timer === null) return;
    if (!this.#host.awaitingAgentStart || this.#host.streaming) this.stop();
  }

  /** Cancel without firing (teardown, an explicit destroy). */
  stop(): void {
    // The guard narrows `null` for `clearTimeout`; it also mirrors IdleReaper.
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
