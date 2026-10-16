/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Signalling a run's whole process GROUP.
 *
 * Its own module because both halves of the registry signal — the run half on a
 * stop's escalation, the sweep half on a disable — and a helper duplicated across
 * them is how one of the two ends up killing only the shell.
 */

/** Signal a whole process group, tolerating a group that is already gone. */
export function killGroup(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
  try {
    // The NEGATIVE pid is the group: `detached: true` made the child its leader.
    process.kill(-pid, signal);
  } catch {
    // Already exited, or the group was reaped. Either way there is nothing to
    // signal, and a throw here would abort the sweep mid-way.
  }
}
