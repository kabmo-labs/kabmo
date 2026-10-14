/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sampler: which processes count, and what their CPU and RAM come to.
 *
 * ## The process set is a UNION, and that is the load-bearing decision
 *
 * The obvious answer — walk the ppid tree from the chamber's own pid — is
 * measurably incomplete. An omp daemon broker is spawned `{ detached: true }`
 * and `unref()`ed by omp, so it outlives the omp process that started it and is
 * reparented to `1`. Measured on this machine: one broker sat under the server
 * and one did not, and the orphan supervised THIS project's Chromium — 9
 * processes, ~470 MB, invisible to a tree walk.
 *
 * So the set is:
 *
 *   1. the ppid tree rooted at the chamber's pid — omp children and their LSP
 *      grandchildren, the utility children, prewarm entries, PTY shells and
 *      whatever they run; and
 *   2. the subtree under every daemon registry entry, broker and daemon alike,
 *      deduped by pid.
 *
 * `detached: true` does NOT break the ppid link (verified for both the PTY
 * shell and the omp child — detaching changes the process GROUP, which is what
 * the group-kill uses), so the tree walk is complete for everything the chamber
 * spawned and the registry covers everything omp detached from it.
 *
 * ## CPU is a RATE, so the sampler keeps the previous reading
 *
 * Every platform reports cumulative CPU time, so a single sample says nothing.
 * The sampler holds the previous sweep's `cpuNs` per pid plus the wall clock and
 * reports `Δcpu / Δwall`. The first sweep therefore has no CPU at all, and says
 * so (`null`) rather than reporting `0%`, which would read as a measurement.
 *
 * A process that appeared since the last sweep has no baseline and reports no
 * rate for one sample — the same honest gap, for the same reason.
 */

import os from 'node:os';

import { classifyProcesses, type DaemonEntry, type ProcessCategory } from './classify';
import { readDaemonRegistry } from './daemons';
import { procProbe } from './proc';
import type { ProcessInfo } from './proc/types';

/** One process, as the panel renders its row. */
export interface ProcessRow {
  pid: number;
  ppid: number;
  category: ProcessCategory;
  /** The executable basename, or the whole argv's head when that is a runtime. */
  command: string;
  /** Resident bytes. */
  rss: number;
  /** CPU percent over the last interval, or null on the first sighting. */
  cpuPercent: number | null;
  threads: number;
}

/** One category's totals. */
export interface CategoryTotal {
  category: ProcessCategory;
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
  /** Per-category rollups, heaviest first. */
  totals: CategoryTotal[];
  /** The whole union. */
  total: { processes: number; rss: number; cpuPercent: number };
  machine: MachineContext;
  /** omp daemons the registry reports, so a row can be named by its daemon. */
  daemons: DaemonEntry[];
  /** The chamber's own pid, so the panel can mark it. */
  serverPid: number;
  /** Sparkline series, oldest first. Absent when history is disabled. */
  history?: { rss: number[]; cpuPercent: number[] };
  /** Why the table is empty, when it is. */
  error?: string;
}

/** What the sampler needs to know about the chamber, injected so it is testable. */
export interface SampleDeps {
  /** The chamber's pid — the tree root. */
  serverPid: number;
  /** Shell basenames the terminal may have launched. */
  shellNames: readonly string[];
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
}

/** A previous reading, for the rate. */
interface Baseline {
  at: number;
  cpuNs: Map<number, number>;
}

/**
 * Which processes belong to the chamber, by pid.
 *
 * Both halves of the union in one pass, and the daemon half walks the SAME
 * parent map rather than recursing a second time: the map is already built.
 */
function collectProcessSet(
  list: readonly ProcessInfo[],
  serverPid: number,
  daemons: readonly DaemonEntry[],
  includeDaemons: boolean,
): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const process of list) {
    const siblings = childrenOf.get(process.ppid);
    if (siblings) siblings.push(process.pid);
    else childrenOf.set(process.ppid, [process.pid]);
  }

  const included = new Set<number>();
  // Iterative, and every push is guarded by `included`: a pid cycle (which a
  // recycled pid can produce) would otherwise loop forever.
  const queue = [serverPid];
  while (queue.length > 0) {
    const pid = queue.pop() as number;
    if (included.has(pid)) continue;
    included.add(pid);
    for (const child of childrenOf.get(pid) ?? []) {
      if (!included.has(child)) queue.push(child);
    }
  }

  if (includeDaemons) {
    for (const daemon of daemons) {
      for (const root of [daemon.brokerPid, daemon.pid]) {
        if (root === null) continue;
        queue.push(root);
      }
    }
    while (queue.length > 0) {
      const pid = queue.pop() as number;
      if (included.has(pid)) continue;
      included.add(pid);
      for (const child of childrenOf.get(pid) ?? []) {
        if (!included.has(child)) queue.push(child);
      }
    }
  }

  return included;
}

/**
 * The label a row shows.
 *
 * A `bun` process's argv head is the runtime, not the program, so the SECOND
 * argument is the honest name when the first is a known runtime and the second
 * is a script path. Without this every omp child, the broker and the chamber
 * itself read as `bun`.
 *
 * `bun run <script>` needs one more step: the second argument is the
 * subcommand (`run`), not the program, so a label taken there names every
 * `bun run` process `run`. The first non-flag argument AFTER the subcommand is
 * the script — which is the same rule, applied one position later.
 */
function commandLabel(process: ProcessInfo): string {
  const argv = process.argv;
  if (!argv || argv.length === 0) return '?';
  const basename = (value: string) => {
    const cut = value.lastIndexOf('/');
    return cut === -1 ? value : value.slice(cut + 1);
  };
  const head = basename(argv[0]);
  if (head !== 'bun' && head !== 'node') return head;
  // `run`/`exec`/`x` are subcommands; the script is the argument after them.
  const SUBCOMMANDS = new Set(['run', 'exec', 'x', 'test']);
  let index = 1;
  if (argv[index] !== undefined && SUBCOMMANDS.has(argv[index])) index += 1;
  const candidate = argv[index];
  // `-e` / `-p` / any flag means there is no script to name; keep the runtime.
  if (candidate === undefined || candidate.startsWith('-')) return head;
  return basename(candidate);
}

export interface Sampler {
  /** Take one sample. */
  sample(): StatsSnapshot;
  /** Drop the baseline and history — after a settings change. */
  reset(): void;
}

/**
 * Build a sampler. One per plugin, so its baseline and history live as long as
 * the plugin does and are dropped with it.
 */
export function createSampler(deps: SampleDeps): Sampler {
  const probe = deps.probe ?? procProbe;
  const readDaemons = deps.readDaemons ?? readDaemonRegistry;
  const includeDaemons = deps.includeDaemons ?? true;
  const historyPoints = deps.historyPoints ?? 60;

  let baseline: Baseline | null = null;
  const rssHistory: number[] = [];
  const cpuHistory: number[] = [];

  return {
    reset() {
      baseline = null;
      rssHistory.length = 0;
      cpuHistory.length = 0;
    },
    sample(): StatsSnapshot {
      const at = deps.now();
      const list = probe.supported ? probe.list() : [];
      const daemons = includeDaemons ? readDaemons() : [];
      const included = collectProcessSet(list, deps.serverPid, daemons, includeDaemons);

      const previous = baseline;
      const cpuNsNow = new Map<number, number>();
      const elapsed = previous ? Math.max(at - previous.at, 1) : 0;

      const rows: ProcessRow[] = [];
      const byCategory = new Map<ProcessCategory, CategoryTotal>();
      const categories = classifyProcesses(list, {
        serverPid: deps.serverPid,
        shellNames: deps.shellNames,
        daemons,
      });

      for (const process of list) {
        if (!included.has(process.pid)) continue;
        cpuNsNow.set(process.pid, process.cpuNs);
        const before = previous?.cpuNs.get(process.pid);
        // A process with no baseline reports NO rate: it is either brand new or
        // the first sweep, and `0%` for either would be a fabricated reading.
        const cpuPercent =
          before === undefined || !previous
            ? null
            : Math.max(0, ((process.cpuNs - before) / 1e6 / elapsed) * 100);

        const category = categories.get(process.pid) ?? 'other';
        rows.push({
          pid: process.pid,
          ppid: process.ppid,
          category,
          command: commandLabel(process),
          rss: process.rss,
          cpuPercent,
          threads: process.threads,
        });

        const rollup = byCategory.get(category) ?? { category, processes: 0, rss: 0, cpuPercent: 0 };
        rollup.processes += 1;
        rollup.rss += process.rss;
        rollup.cpuPercent += cpuPercent ?? 0;
        byCategory.set(category, rollup);
      }

      baseline = { at, cpuNs: cpuNsNow };

      rows.sort((a, b) => b.rss - a.rss);
      const totals = [...byCategory.values()].sort((a, b) => b.rss - a.rss);
      const total = {
        processes: rows.length,
        rss: totals.reduce((sum, entry) => sum + entry.rss, 0),
        cpuPercent: totals.reduce((sum, entry) => sum + entry.cpuPercent, 0),
      };

      let history: StatsSnapshot['history'];
      if (historyPoints > 0) {
        rssHistory.push(total.rss);
        cpuHistory.push(Number(total.cpuPercent.toFixed(1)));
        while (rssHistory.length > historyPoints) rssHistory.shift();
        while (cpuHistory.length > historyPoints) cpuHistory.shift();
        history = { rss: [...rssHistory], cpuPercent: [...cpuHistory] };
      }

      const snapshot: StatsSnapshot = {
        sampledAt: at,
        probe: { name: probe.name, supported: probe.supported, ...(probe.reason ? { reason: probe.reason } : {}) },
        rows,
        totals,
        total,
        machine: {
          totalMemBytes: os.totalmem(),
          freeMemBytes: os.freemem(),
          cpuCount: os.cpus().length,
          loadPerCore: os.cpus().length > 0 ? os.loadavg()[0] / os.cpus().length : os.loadavg()[0],
        },
        daemons,
        serverPid: deps.serverPid,
        ...(history ? { history } : {}),
        ...(probe.supported ? {} : { error: probe.reason ?? `No process probe for ${process.platform}.` }),
      };
      return snapshot;
    },
  };
}
