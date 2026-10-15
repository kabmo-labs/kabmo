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

import { type DaemonEntry, readDaemonRegistry } from './daemons';
import { assignGroups, type GroupKind } from './groups';
import { describeProcess } from './labels';
import { leaseOfPid } from './proc/identity';
import { procProbe } from './proc';
import type { ProcessInfo } from './proc/types';
import type { GroupSummary, ProcessRow, SampleDeps, StatsSnapshot } from './snapshot';

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
 * The order groups are listed in.
 *
 * The chamber first (it is the thing the panel is about), then the SESSIONS
 * doing work, then idle capacity, then the shared daemons — which are usually
 * the largest but belong to no session — and the terminal last. Sorting by size
 * instead would reorder the panel on every sample and make it unreadable.
 */
const GROUP_ORDER: readonly GroupKind[] = [
  'chamber',
  'session',
  'utility',
  'prewarm',
  'daemon',
  'broker',
  'terminal',
  'other',
];

/** A group's position in `GROUP_ORDER`. */
function groupRank(group: GroupSummary): number {
  const index = GROUP_ORDER.indexOf(group.kind);
  return index === -1 ? GROUP_ORDER.length : index;
}

export type { GroupSummary, ProcessRow, SampleDeps, StatsSnapshot } from './snapshot';

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
  const readLease = deps.readLease ?? leaseOfPid;
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
      const kept = list.filter((process) => included.has(process.pid));

      // The lease is read BEFORE grouping, because it is what separates a live
      // session from an idle prewarm — argv cannot, since a host that adopted a
      // prewarm keeps the prewarm's argv forever. Only an `omp` host can hold
      // one, so the walk is paid for those alone. The flag test joins argv: the
      // two tokens arrive separately (`--mode`, `rpc-ui`), never as one string.
      const leases = new Map<number, string | null>();
      for (const process of kept) {
        const line = (process.argv ?? []).join(' ');
        if (line.includes('--mode rpc-ui')) leases.set(process.pid, readLease(process.pid));
      }

      const previous = baseline;
      const cpuNsNow = new Map<number, number>();
      const elapsed = previous ? Math.max(at - previous.at, 1) : 0;

      const rows: ProcessRow[] = [];
      const assignments = assignGroups(kept, { serverPid: deps.serverPid, daemons, leases });
      const byGroup = new Map<string, GroupSummary>();

      for (const process of kept) {
        cpuNsNow.set(process.pid, process.cpuNs);
        const before = previous?.cpuNs.get(process.pid);
        // A process with no baseline reports NO rate: it is either brand new or
        // the first sweep, and `0%` for either would be a fabricated reading.
        const cpuPercent =
          before === undefined || !previous
            ? null
            : Math.max(0, ((process.cpuNs - before) / 1e6 / elapsed) * 100);

        const assignment = assignments.get(process.pid) ?? { key: 'other', ownerPid: 0, depth: 0, kind: 'other' as const };
        const label = describeProcess(process, {
          now: at,
          serverPid: deps.serverPid,
          lease: leases.get(process.pid) ?? null,
        });

        rows.push({
          pid: process.pid,
          ppid: process.ppid,
          title: label.title,
          detail: label.detail,
          groupKey: assignment.key,
          depth: assignment.depth,
          rss: process.rss,
          cpuPercent,
          threads: process.threads,
        });

        // A group's header is the OWNER's own label, so a session group reads
        // as the session rather than as whichever member happened to come first.
        const group = byGroup.get(assignment.key) ?? {
          key: assignment.key,
          kind: assignment.kind,
          ownerPid: assignment.ownerPid,
          title: label.title,
          detail: label.detail,
          processes: 0,
          rss: 0,
          cpuPercent: 0,
        };
        group.processes += 1;
        group.rss += process.rss;
        group.cpuPercent += cpuPercent ?? 0;
        if (process.pid === assignment.ownerPid) {
          group.title = label.title;
          group.detail = label.detail;
        }
        byGroup.set(assignment.key, group);
      }

      baseline = { at, cpuNs: cpuNsNow };

      rows.sort((a, b) => b.rss - a.rss);
      const groups = [...byGroup.values()].sort((a, b) => groupRank(a) - groupRank(b) || b.rss - a.rss);
      const total = {
        processes: rows.length,
        rss: groups.reduce((sum, entry) => sum + entry.rss, 0),
        cpuPercent: groups.reduce((sum, entry) => sum + entry.cpuPercent, 0),
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
        groups,
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
