/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The watchdog's DECISION, separated from the interval that drives it.
 *
 * A pure function over two clocks, because the cases that matter are timing
 * cases and a timing case tested through real timers is a test of the clock. The
 * driver in `resume.ts` reads `Date.now()` and calls this; every branch below is
 * pinned directly.
 *
 * Two facts it distinguishes, and neither is available from the browser:
 *
 * - **The page was FROZEN.** A tick that arrives far later than its deadline
 *   cannot be produced by a running interval, so the page was suspended — a
 *   backgrounded phone, a suspended tab. That is a resume, and the failure count
 *   from the frozen window is worthless.
 * - **The socket is SILENT.** An OPEN socket with no inbound traffic for longer
 *   than the idle window is questioned, which catches a connection that died
 *   while the tab stayed visible (a Wi-Fi to cellular handoff).
 *
 * A HIDDEN document is neither: it is legitimately throttled to roughly a tick a
 * minute, so every tick would read as a freeze. Freeze detection is therefore
 * gated on a visible page, while the idle probe is not — that one also repairs a
 * connection that died while the user was in another app, before they return.
 */

/** How often the watchdog runs. */
export const LIVENESS_TICK_MS = 5_000;
/**
 * A tick this much later than it was scheduled means the page was frozen: a
 * running interval cannot skip its own deadline by this much.
 */
export const FREEZE_DETECT_MS = LIVENESS_TICK_MS * 2;
/**
 * Silence on an OPEN socket that justifies a probe. Below the server's 30s
 * protocol heartbeat, so a connection the server is about to reap is checked
 * before the reap rather than after it.
 */
export const IDLE_PROBE_AFTER_MS = 25_000;

export interface WatchdogInput {
  /** Milliseconds since the previous tick fired. */
  sinceTick: number;
  /** Milliseconds since anything last arrived on the open socket. */
  sinceInbound: number;
  /** Whether the document reports itself hidden. */
  hidden: boolean;
  /** Whether a socket is open right now (the probe is only meaningful then). */
  open: boolean;
  /** Whether anyone still wants the channel. */
  wanted: boolean;
}

/**
 * `'wake'` — treat the page as back (reset the budget, probe or re-dial);
 * `'probe'` — question the open socket; `null` — nothing to do.
 */
export type WatchdogAction = 'wake' | 'probe' | null;

export function watchdogAction(input: WatchdogInput): WatchdogAction {
  if (!input.wanted) return null;
  // Ordered: a freeze explains the silence too, and waking is the stronger
  // repair — it re-dials when the socket is already gone, while a probe can only
  // question one the browser still believes in.
  if (input.sinceTick > FREEZE_DETECT_MS && !input.hidden) return 'wake';
  if (!input.open) return null;
  if (input.sinceInbound < IDLE_PROBE_AFTER_MS) return null;
  return 'probe';
}
