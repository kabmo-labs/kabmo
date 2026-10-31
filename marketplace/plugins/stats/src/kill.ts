/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Stopping one process from the panel — the rules, kept out of the RPC
 * registration so they can be tested without a host around them.
 *
 * A kill button is the one control in this panel that can destroy work, so
 * every refusal below is a thing that must not happen rather than an edge case:
 *
 * - **`pid > 1` and an integer.** `process.kill(0, …)` signals the CALLER's
 *   process group and `-1` signals every process the user may signal. A row
 *   can carry neither, and a JSON body can carry anything.
 * - **The Kabmo's own pid is refused.** This panel's server half runs INSIDE
 *   the server it measures, so a kill row for it would take the UI, every live
 *   session and the sampler down together — and the CLI already owns stopping
 *   the server (`kabmo stop`).
 * - **The pid must be in the union a FRESH sample measured.** The table on
 *   screen is up to a sampling interval old, and a pid recycled in between
 *   belongs to a process the user never looked at. The union is also the whole
 *   authority: a pid outside it is not something this panel offers to stop.
 *
 * `SIGTERM`, not `SIGKILL`: omp children flush their transcript on the polite
 * signal, and a process that ignores it should be visible as still running
 * rather than silently destroyed. Pressing again re-sends.
 */

import type { StatsSnapshot } from './snapshot';

/** What the panel is told after asking for a kill. */
export type KillOutcome =
  | { killed: true; pid: number; title: string; signal: 'SIGTERM' }
  | { killed: false; reason: string };

export interface KillDeps {
  /** A fresh sample; its rows are the only pids this may signal. */
  sample: () => StatsSnapshot;
  /** The Kabmo's own pid. */
  serverPid: number;
  /** The signalling call, injected so a test never kills anything. */
  signal?: (pid: number, signal: 'SIGTERM') => void;
}

/**
 * Signal one process in the measured stack, or explain why not.
 *
 * Never throws: every failure is an outcome the panel renders in its dialog.
 */
export function killStackProcess(pid: unknown, deps: KillDeps): KillOutcome {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1) {
    return { killed: false, reason: 'That request did not name a process id above 1.' };
  }
  if (pid === deps.serverPid) {
    return { killed: false, reason: 'Refusing to stop the Kabmo server from its own panel — that is `kabmo stop`.' };
  }
  const row = deps.sample().rows.find((candidate) => candidate.pid === pid);
  if (!row) {
    return {
      killed: false,
      reason: `pid ${pid} is not part of the stack this panel measures — the table may be stale, so refresh and try again.`,
    };
  }
  try {
    (deps.signal ?? ((target, signal) => process.kill(target, signal)))(pid, 'SIGTERM');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ESRCH') return { killed: false, reason: `pid ${pid} already exited.` };
    if (code === 'EPERM') return { killed: false, reason: `pid ${pid} belongs to another user, so it cannot be signalled.` };
    return { killed: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { killed: true, pid, title: row.title, signal: 'SIGTERM' };
}