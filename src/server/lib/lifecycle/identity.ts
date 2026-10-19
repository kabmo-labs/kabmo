/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Process identity for a PID recorded for a port.
 *
 * Liveness alone cannot answer "is this PID still an OMPChamber server": after
 * an ungraceful exit the PID can be recycled to an unrelated process, and a
 * liveness-only check then reports a live instance nobody is serving — which
 * either blocks startup on a free port or, worse, lets a stale record name a
 * stranger. Identity therefore comes from the OS command line, so a recycled
 * PID reads back as `mismatched`.
 *
 * How the OS is asked is per platform and lives in `./probe` — macOS through
 * `libproc`, Linux through `/proc`, Windows through signal 0 alone, the BSDs
 * through `ps`. This module only turns those answers into the states callers
 * reason about.
 *
 * Where identity cannot be read, it is reported as `unknown` and callers fall
 * back to liveness — never treated as confirmation that the PID is ours.
 */

import { processProbe } from '@/server/lib/lifecycle/proc';

export type ProcessState = 'dead' | 'matched' | 'mismatched' | 'unknown';

/**
 * Liveness check. Never throws.
 *
 * A defunct (zombie) PID still answers signal 0 — the process has exited and is
 * only waiting for its parent to reap it — so a zombie counts as not alive: it
 * holds no port and will never run again. Without this, a stop that worked
 * looks like a process that "ignored SIGTERM", and stop-waits spin until their
 * timeout.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  const liveness = processProbe.liveness(pid);
  // A zombie is NOT alive: it holds no port and will never run again. An
  // `unknown` (a probe that could not answer) keeps the previous bias and
  // counts as alive, so a sandboxed host cannot make a live server look dead.
  return liveness === 'alive' || liveness === 'unknown';
}

/**
 * Whether an OS command line belongs to this product.
 *
 * Both names are accepted: a checkout or package directory carries whichever
 * name it was installed under, and a `kabmo` server must be recognized as ours
 * just as an `ompchamber` one is (port guard, stop, restart, update ownership).
 */
export function isChamberCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return lower.includes('ompchamber') || lower.includes('kabmo');
}

/**
 * `dead` | `matched` | `mismatched` | `unknown` for a PID.
 *
 * `unknown` means identity could not be read; callers treat it as "alive but
 * unverified" — never as confirmation that the PID is ours.
 */
export function getProcessState(pid: number): ProcessState {
  if (!isProcessAlive(pid)) return 'dead';
  const command = processProbe.commandLine(pid);
  if (command === null) return 'unknown';
  return isChamberCommand(command) ? 'matched' : 'mismatched';
}

/**
 * Parent pid of a live process, or null when the platform cannot answer.
 *
 * Read through the same probe the rest of this module uses (libproc, `/proc`,
 * `ps`) — never a `ps` subprocess of its own.
 */
export function processParentPid(pid: number): number | null {
  if (!isProcessAlive(pid)) return null;
  return processProbe.parentPid(pid);
}
