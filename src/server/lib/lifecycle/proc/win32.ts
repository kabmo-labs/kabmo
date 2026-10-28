/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Windows process probe.
 *
 * Deliberately the thinnest of the three, because Windows is where the other
 * two mechanisms have no equivalent:
 *
 *   - There is no `ps` and no `/proc`.
 *   - There is no zombie: a process object lives until its last handle closes,
 *     so "exited but not reaped" is not a state that can be observed. `isZombie`
 *     is therefore always false rather than a guess.
 *   - A foreign process's command line is not reachable without walking its PEB
 *     through `ntdll` while it is suspended — untestable here and far more
 *     dangerous than the problem it solves. `commandLine` returns null, which
 *     `getProcessState` already reports as `unknown`, and callers treat
 *     `unknown` as "alive but unverified" — never as confirmation.
 *
 * So identity on Windows is liveness, exactly as before this module existed;
 * the value here is that the behaviour is stated instead of emerging from a
 * `ps` snapshot that silently comes back empty.
 */

import type { ProcessProbe } from '@/server/lib/lifecycle/proc/types';

function signalAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the PID exists, we may not signal it.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export const win32Probe: ProcessProbe = {
  commandLine() {
    return null;
  },
  liveness(pid) {
    // No zombie state is observable on Windows (a process object lives until
    // its last handle closes), so signal 0 is the whole answer.
    return signalAlive(pid) ? 'alive' : 'dead';
  },
  isAlive: signalAlive,
  isZombie() {
    return false;
  },
  foregroundGroup() {
    // Windows has no process group tied to a console the way a POSIX PTY has
    // `tpgid`, and no `ps` either — the caller's own platform check keeps this
    // from being asked, and null says "unknown" rather than guessing.
    return null;
  },
  parentPid() {
    // Not reachable without walking the process table through `ntdll`; the
    // ownership guard already degrades to a refusal when the parent is unknown,
    // and Windows has no `flock` for it to reach anyway.
    return null;
  },
};
