/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
  rss: number;
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
  total: { processes: number; rss: number; cpuPercent: number };
  machine: MachineContext;
  /** omp daemons the registry reports, so a row can be named by its daemon. */
  daemons: DaemonEntry[];
  /** The Kabmo's own pid, so the panel can mark it. */
  serverPid: number;
  /** Sparkline series, oldest first. Absent when history is disabled. */
  history?: { rss: number[]; cpuPercent: number[] };
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
   * The lease lookup, injected so the sampler is testable without libproc.
   *
   * It is what separates a live session from an idle prewarm, and the real one
   * walks a foreign process's descriptor table — not something a unit test can
   * arrange.
   */
  readLease?: (pid: number) => string | null;
}
