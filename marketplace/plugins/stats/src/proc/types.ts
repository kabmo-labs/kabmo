/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a process probe answers, in units the sampler can subtract.
 *
 * Two fields are deliberately NOT in the platform's own vocabulary:
 *
 * - `cpuNs` is CUMULATIVE CPU time in NANOSECONDS. Every platform reports it in
 *   its own tick unit (mach absolute-time ticks on Darwin, `CLK_TCK`-based
 *   jiffies on Linux, a formatted string from `ps`), and converting at the probe
 *   is what keeps the sampler's delta math unit-free. Measured on this machine:
 *   reading Darwin's ticks as nanoseconds understates CPU by ~41x
 *   (`mach_timebase_info` is 125/3, not 1).
 * - `rss` is resident bytes, never pages: Linux's `/proc/<pid>/statm` counts
 *   pages and the page size differs between a container (4 KB) and the host
 *   (16 KB on Apple silicon), so a page count carried out of the probe would be
 *   silently wrong by 4x on one of them.
 *
 * A cumulative counter is the right shape for both: a rate needs two readings
 * anyway, and a cumulative value survives a missed sample.
 */
export interface ProcessInfo {
  pid: number;
  /** Parent pid, 0 when the platform cannot report it. */
  ppid: number;
  /** Resident set size in bytes. */
  rss: number;
  /** Cumulative CPU time (user + system) in nanoseconds. */
  cpuNs: number;
  /** Thread count, 0 when the platform cannot report it. */
  threads: number;
  /**
   * argv as the kernel has it, or null when unreadable.
   *
   * Null is a real answer and not a failure to report: a process owned by
   * another user, a kernel thread, and a pid that exited mid-sweep all read
   * back this way, and the classifier treats null as "unknown", never as a
   * reason to drop the row.
   */
  argv: string[] | null;
  /**
   * The process's current working directory, or null when unreadable.
   *
   * This is what names the project for a process whose argv does not carry one
   * — a `tsserver`, a Chromium helper, a `codegraph` MCP server. Null is a real
   * answer (a kernel task, a process we may not inspect), never a reason to drop
   * the row.
   */
  cwd: string | null;
  /**
   * Epoch milliseconds the process started, or 0 when the platform cannot say.
   *
   * Age is the one figure that makes a leak visible: a prewarmed host that has
   * been idle for two hours is a different fact from one spawned a minute ago,
   * and only the start time separates them.
   */
  startedAt: number;
}

/**
 * One platform's whole-table read.
 *
 * `list()` is a single sweep, never a per-pid question: the sampler needs every
 * process to build the parent map, and a probe that answered one pid at a time
 * would walk the table once per process.
 */
export interface ProcProbe {
  /** The platform this probe serves, for the panel's identity block. */
  name: string;
  /** False when this platform cannot answer at all — see `win32.ts`. */
  supported: boolean;
  /** Why it cannot, for the panel to say instead of drawing an empty table. */
  reason?: string;
  list(): ProcessInfo[];
}
