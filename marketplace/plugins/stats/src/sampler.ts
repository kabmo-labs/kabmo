/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sampler: which processes count, and what their CPU and RAM come to.
 *
 * ## The process set is a UNION, and that is the load-bearing decision
 *
 * The obvious answer — walk the ppid tree from Kabmo's own pid — is
 * measurably incomplete. An omp daemon broker is spawned `{ detached: true }`
 * and `unref()`ed by omp, so it outlives the omp process that started it and is
 * reparented to `1`. Measured on this machine: one broker sat under the server
 * and one did not, and the orphan supervised THIS project's Chromium — 9
 * processes, ~470 MB, invisible to a tree walk.
 *
 * So the set is:
 *
 *   1. the ppid tree rooted at Kabmo's pid — omp children and their LSP
 *      grandchildren, the utility children, prewarm entries, PTY shells and
 *      whatever they run; and
 *   2. the subtree under every daemon registry entry, broker and daemon alike,
 *      deduped by pid.
 *
 * `detached: true` does NOT break the ppid link (verified for both the PTY
 * shell and the omp child — detaching changes the process GROUP, which is what
 * the group-kill uses), so the tree walk is complete for everything Kabmo
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
 *
 * ## The memory figure is the OS's charge, not RSS
 *
 * RSS on macOS counts pages Bun has freed but not returned: measured on the
 * live server, 317 MB resident for a process whose physical footprint was
 * 134 MB. The panel is what a reader uses to decide whether to restart
 * something, so each row reports `footprint ?? rss` and remembers which it is;
 * the totals sum that same figure, and `memorySource` says when the sample
 * mixed the two (see `./machine` for the platform rules).
 */

import { type DaemonEntry, readDaemonRegistry } from './daemons';
import { readMachine } from './machine';
import { assignGroups, type GroupKind } from './groups';
import { readHarnessLeases, type SessionLease } from './harness-leases';
import { describeProcess } from './labels';
import { leaseOfPid } from './proc/identity';
import { procProbe } from './proc';
import type { ProcessInfo } from './proc/types';
import type { GroupSummary, ProcessRow, SampleDeps, StatsSnapshot } from './snapshot';

/**
 * How far a lease's spawn time may sit from the probe's own start time.
 *
 * The host writes the lease immediately after the spawn, so the two agree to
 * within milliseconds; the window exists for a loaded machine and for a
 * prewarm whose `initialize` ran before the write. A pid recycled outside it
 * belongs to a process the user never looked at, and naming it after a chat is
 * worse than leaving it unattributed.
 */
const LEASE_START_TOLERANCE_MS = 5_000;

/** A previous reading, for the rate. */
interface Baseline {
  at: number;
  cpuNs: Map<number, number>;
}

/**
 * Which processes belong to Kabmo, by pid.
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
 * The Kabmo first (it is the thing the panel is about), then the SESSIONS
 * doing work, then idle capacity, then the shared daemons — which are usually
 * the largest but belong to no session — and the terminal last. Sorting by size
 * instead would reorder the panel on every sample and make it unreadable.
 */
const GROUP_ORDER: readonly GroupKind[] = [
  'kabmo',
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
  const readAcpLeases = deps.readHarnessLeases ?? readHarnessLeases;
  const includeDaemons = deps.includeDaemons ?? true;
  const historyPoints = deps.historyPoints ?? 60;
  const readFacts = deps.readMachine ?? readMachine;

  let baseline: Baseline | null = null;
  const memoryHistory: number[] = [];
  const cpuHistory: number[] = [];

  return {
    reset() {
      baseline = null;
      memoryHistory.length = 0;
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
      // prewarm keeps the prewarm's argv forever. Two sources, one map: omp's
      // `flock` lease (an RPC host) and Kabmo's per-pid file (an ACP child).
      // The flag test joins argv: the two tokens arrive separately (`--mode`,
      // `rpc-ui`), never as one string.
      const acpLeases = readAcpLeases();
      const leases = new Map<number, SessionLease>();
      for (const process of kept) {
        const line = (process.argv ?? []).join(' ');
        if (line.includes('--mode rpc-ui')) {
          const id = readLease(process.pid);
          if (id) {
            leases.set(process.pid, {
              sessionId: id,
              harness: 'omp-rpc',
              label: 'omp',
              title: '',
              state: 'session',
              cwd: '',
            });
          }
        }
        const acp = acpLeases.get(process.pid);
        // A recycled pid is the one way a lease can name the wrong process.
        // `startedAt === 0` means the probe could not report a start time, and
        // the pid match is then the only signal there is.
        if (acp && (process.startedAt === 0 || Math.abs(process.startedAt - acp.startedAt) <= LEASE_START_TOLERANCE_MS)) {
          leases.set(process.pid, acp);
        }
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
        const footprint = process.footprint;
        const memory = footprint ?? process.rss;

        rows.push({
          pid: process.pid,
          ppid: process.ppid,
          title: label.title,
          detail: label.detail,
          groupKey: assignment.key,
          depth: assignment.depth,
          memory,
          memorySource: footprint === null ? 'rss' : 'footprint',
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
          memory: 0,
          cpuPercent: 0,
        };
        group.processes += 1;
        group.memory += memory;
        group.cpuPercent += cpuPercent ?? 0;
        if (process.pid === assignment.ownerPid) {
          group.title = label.title;
          group.detail = label.detail;
        }
        byGroup.set(assignment.key, group);
      }

      baseline = { at, cpuNs: cpuNsNow };

      const footprints = rows.filter((row) => row.memorySource === 'footprint').length;
      const memorySource: StatsSnapshot['memorySource'] = footprints === 0 ? 'rss'
        : footprints === rows.length ? 'footprint'
        : 'mixed';

      rows.sort((a, b) => b.memory - a.memory);
      const groups = [...byGroup.values()].sort((a, b) => groupRank(a) - groupRank(b) || b.memory - a.memory);
      const total = {
        processes: rows.length,
        memory: groups.reduce((sum, entry) => sum + entry.memory, 0),
        cpuPercent: groups.reduce((sum, entry) => sum + entry.cpuPercent, 0),
      };

      let history: StatsSnapshot['history'];
      if (historyPoints > 0) {
        memoryHistory.push(total.memory);
        cpuHistory.push(Number(total.cpuPercent.toFixed(1)));
        while (memoryHistory.length > historyPoints) memoryHistory.shift();
        while (cpuHistory.length > historyPoints) cpuHistory.shift();
        history = { memory: [...memoryHistory], cpuPercent: [...cpuHistory] };
      }

      const snapshot: StatsSnapshot = {
        sampledAt: at,
        probe: { name: probe.name, supported: probe.supported, ...(probe.reason ? { reason: probe.reason } : {}) },
        rows,
        groups,
        total,
        memorySource,
        machine: readFacts(),
        daemons,
        serverPid: deps.serverPid,
        ...(history ? { history } : {}),
        ...(probe.supported ? {} : { error: probe.reason ?? `No process probe for ${process.platform}.` }),
      };
      return snapshot;
    },
  };
}
