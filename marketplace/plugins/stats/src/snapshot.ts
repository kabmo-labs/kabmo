/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shapes the sampler publishes, split out so the sampler stays about the
 * MEASURING.
 *
 * `ProcessRow` is one process as the panel renders it; `GroupSummary` is one
 * owner and everything it spawned; `StatsSnapshot` is the whole sample as the
 * realtime topic carries it. The panel and the server half both read these, and
 * a change to one of them is a change to the wire.
 */

import type { DaemonEntry } from './daemons';
import type { GroupKind } from './groups';
import type { HarnessLease } from './harness-leases';
import type { ProcessInfo } from './proc/types';

/** One process, as the panel renders its row. */
export interface ProcessRow {
  pid: number;
  ppid: number;
  /** The bold line: what this process IS, from `describeProcess`. */
  title: string;
  /** The muted line under it: project, identity, age. */
  detail: string;
  /** The group this row belongs to — a session, a prewarm, a daemon. */
  groupKey: string;
  /** Distance from the group's owner; 0 is the owner itself. */
  depth: number;
  /**
   * The figure the panel shows and sorts by: the OS's physical footprint when
   * it reports one, resident size otherwise. See `memorySource`.
   */
  memory: number;
  /**
   * Which of the two `memory` is, per row.
   *
   * Both exist because a row can fall back independently: on macOS a process
   * owned by another user answers no footprint, and dropping its RSS would
   * remove it from the totals instead of reporting what is known.
   */
  memorySource: 'footprint' | 'rss';
  /** Resident set size, kept beside `memory` so a row can explain the gap. */
  rss: number;
  cpuPercent: number | null;
  threads: number;
}

/**
 * One group's rollup.
 *
 * The figures are summed over the group's members, so a header is never a
 * number without a column: a session's memory is what its host and every child
 * it spawned actually hold, which is the number a reader is looking for and
 * cannot get by adding up rows by eye.
 */
export interface GroupSummary {
  key: string;
  kind: GroupKind;
  /** The owning process's pid — the one the group is named after. */
  ownerPid: number;
  /** The owner's own title, so the header needs no second lookup. */
  title: string;
  /** The owner's detail line. */
  detail: string;
  processes: number;
  /** Sum of the members' `memory` — the same figures the rows print. */
  memory: number;
  cpuPercent: number;
}

/** The machine-level context the totals are read against. */
export interface MachineContext {
  totalMemBytes: number;
  freeMemBytes: number;
  cpuCount: number;
  /** 1-minute load average per core. */
  loadPerCore: number;
}

/** One sample, as the plugin publishes it on its realtime topic. */
export interface StatsSnapshot {
  /** When this sample was taken (epoch ms). */
  sampledAt: number;
  /** The probe that answered, and whether it could. */
  probe: { name: string; supported: boolean; reason?: string };
  /** Every process in the union, heaviest first. */
  rows: ProcessRow[];
  /**
   * Per-group rollups, in display order — the panel's primary structure.
   *
   * A session and everything it spawned, with the memory that actually belongs
   * to it. This replaced a per-CATEGORY rollup, which flattened the tree: one
   * `omp` bucket held four prewarms, a live session, five js-eval sandboxes, a
   * broker and a relay, and the parent links that separate them were already
   * in the sweep.
   */
  groups: GroupSummary[];
  /** The whole union. */
  total: { processes: number; memory: number; cpuPercent: number };
  /**
   * Which figure `memory` is across the sample.
   *
   * `footprint` when every row reported one, `rss` when none did, `mixed` when
   * both appear — the panel needs to say which, because a sum of two different
   * quantities must not be labelled as one of them.
   */
  memorySource: 'footprint' | 'rss' | 'mixed';
  machine: MachineContext;
  /** omp daemons the registry reports, so a row can be named by its daemon. */
  daemons: DaemonEntry[];
  /** The Kabmo's own pid, so the panel can mark it. */
  serverPid: number;
  /** Sparkline series, oldest first. Absent when history is disabled. */
  history?: { memory: number[]; cpuPercent: number[] };
  /** Why the table is empty, when it is. */
  error?: string;
}

/** What the sampler needs to know about Kabmo, injected so it is testable. */
export interface SampleDeps {
  /** The Kabmo's pid — the tree root. */
  serverPid: number;
  /** Wall clock, for the rate denominator. */
  now: () => number;
  /** The probe to read. Defaults to the platform's own. */
  probe?: { name: string; supported: boolean; reason?: string; list(): ProcessInfo[] };
  /** The daemon registry read. Defaults to the on-disk reader. */
  readDaemons?: () => DaemonEntry[];
  /** Whether to follow the daemon registry at all. */
  includeDaemons?: boolean;
  /** Samples retained for the sparklines; 0 disables history. */
  historyPoints?: number;
  /**
   * The machine reading, injected so a unit test does not spawn `vm_stat`.
   * Defaults to `readMachine` from `./machine`.
   */
  readMachine?: () => MachineContext;
  /**
   * The lease lookup, injected so the sampler is testable without libproc.
   *
   * It is what separates a live session from an idle prewarm, and the real one
   * walks a foreign process's descriptor table — not something a unit test can
   * arrange.
   */
  readLease?: (pid: number) => string | null;
  /**
   * Kabmo's per-pid leases for ACP children, injected so a test never reads the
   * developer's own `~/.kabmo/run/harness-sessions`.
   */
  readHarnessLeases?: () => Map<number, HarnessLease>;
}
