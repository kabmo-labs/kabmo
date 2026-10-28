/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a platform must be able to answer about a foreign PID, in its own
 * syscall vocabulary. One implementation per OS, selected in `identity.ts`.
 *
 * Every method must degrade rather than throw: a diagnostic question about a
 * PID is never worth failing a request over, and a platform that cannot answer
 * says so (`null` / `false`) so the caller can fall back.
 */
export type ProcessLiveness =
  /** The PID exists and is running. */
  | 'alive'
  /** Exited, waiting for its parent to reap it: holds no port, never runs again. */
  | 'zombie'
  /** No such process. */
  | 'dead'
  /** The platform could not answer — callers must NOT read this as "dead". */
  | 'unknown';

export interface ProcessProbe {
  /** Command line of a live PID, or null when unreadable. */
  commandLine(pid: number): string | null;
  /**
   * Liveness in ONE lookup. This is the question `identity.ts` actually asks,
   * and asking it as `isAlive(pid) && !isZombie(pid)` made the macOS probe
   * issue the identical `sysctl(KERN_PROC_PID)` twice for the same PID
   * (measured 21.3 µs against 5.3 µs for the single read).
   */
  liveness(pid: number): ProcessLiveness;
  /** True when the PID exists. */
  isAlive(pid: number): boolean;
  /** True when the PID is defunct — exited but not yet reaped by its parent.
   *  Such a PID still answers signal 0 and holds no port. */
  isZombie(pid: number): boolean;
  /**
   * Foreground process group of the PID's controlling terminal — the value
   * `ps -o tpgid=` prints, including its `0` for "no controlling terminal".
   * Null when this platform (or this call) cannot answer, which is the
   * caller's signal to fall back to `ps`.
   *
   * A PTY's `tpgid` is what tells a shell sitting at its prompt (the group is
   * the shell itself) from one running a command (the group is that command),
   * so it is the exact answer to "is this terminal busy".
   */
  foregroundGroup(pid: number): number | null;
  /**
   * Parent pid of a live process, or null when unreadable.
   *
   * Used to attribute a process to Kabmo instance that spawned it: an omp
   * child's parent IS the server, which is how a session owned by ANOTHER
   * instance is told from this process's own child.
   */
  parentPid(pid: number): number | null;
}
