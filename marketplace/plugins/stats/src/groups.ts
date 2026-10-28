/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which processes belong together, decided by the parent links the sweep read.
 *
 * The panel used to bucket rows by CATEGORY, which flattens the tree: `omp`
 * became one bucket of 25 rows holding four prewarms, a live session, five
 * js-eval sandboxes, five codegraph servers, a broker, a relay and a utility.
 * The ppid links say something much more useful — each of those hangs off a
 * DIFFERENT owner — and a group is what makes an owner and its children read as
 * one thing.
 *
 * ## A group root is one of three shapes
 *
 * | Root | Why |
 * |---|---|
 * | a **direct child of Kabmo** | an omp session host, a prewarm, a utility, a PTY shell — Kabmo spawned it, so it is a thing of its own |
 * | a **daemon root from omp's registry** | the broker is `detached` + `unref`ed, so it is reparented to launchd and a tree walk from Kabmo can never see it |
 * | a **broker** | it supervises SEVERAL daemons (`omp.browser.headed`, `omp.browser.headless`, `omp.lsp.mux` here), so folding it into whichever one a map named first is arbitrary |
 *
 * ## Two orderings that are load-bearing
 *
 * - **The direct-child test comes BEFORE the registry test.** A session host can
 *   spawn its own daemon broker (measured: pid 66310 under a prewarm), and
 *   checking the registry first split that broker out of the session that owns
 *   it.
 * - **Daemon roots come from the registry, never from `broker.pid`.** Measured:
 *   walking from the broker's pid alone dropped `omp.browser.headed`, because a
 *   broker supervises more daemons than the one file names.
 *
 * A process whose chain reaches neither Kabmo nor a known daemon keeps
 * its own key, so it still renders rather than vanishing.
 */

import type { DaemonEntry } from './daemons';
import type { ProcessInfo } from './proc/types';

/** What a group IS, which decides its icon, tone and ordering. */
export type GroupKind = 'kabmo' | 'session' | 'prewarm' | 'utility' | 'daemon' | 'broker' | 'terminal' | 'other';

/** Where one process sits in the tree. */
export interface GroupAssignment {
  /** Groups are compared by this; stable across samples for the same owner. */
  key: string;
  /** The pid that owns the group — the root of its subtree. */
  ownerPid: number;
  /** Distance from the owner: 0 for the root itself. */
  depth: number;
  kind: GroupKind;
}

export interface GroupOptions {
  /** The Kabmo's own pid — the tree root and the terminal-parent test. */
  serverPid: number;
  /** Every daemon omp's registry reports. */
  daemons: readonly DaemonEntry[];
  /**
   * Session leases by pid, when the caller read them.
   *
   * This is what separates a live session from an idle prewarm: argv cannot,
   * because a host that ADOPTED a prewarm keeps the prewarm's argv forever.
   * Measured on this machine: three hosts whose argv said `prewarm` held live
   * leases with titles and hundreds of messages. A host with a lease is a
   * session; one without is idle capacity.
   */
  leases?: ReadonlyMap<number, string | null>;
}

/** A group root the sampler should treat as an owner. */
interface Root {
  kind: GroupKind;
  /** The registry name, for a daemon root — what the group is called. */
  name?: string;
}

/**
 * The roots present in this sweep, by pid.
 *
 * A daemon whose registry entry names no live pid is skipped: the registry
 * keeps every daemon a project ever started (63 entries here, mostly `exited`),
 * and treating those as roots would invent groups with no members.
 */
function rootsOf(list: readonly ProcessInfo[], options: GroupOptions): Map<number, Root> {
  const roots = new Map<number, Root>();
  const byPid = new Map(list.map((process) => [process.pid, process]));

  // Daemons and brokers first: a registry pid may be a direct child of the
  // Kabmo, and the registry knows what it IS while the child test only knows
  // that Kabmo spawned it.
  for (const daemon of options.daemons) {
    if (daemon.state === 'ready' && byPid.has(daemon.pid)) {
      roots.set(daemon.pid, { kind: 'daemon', name: daemon.name });
    }
    if (daemon.brokerPid !== null && byPid.has(daemon.brokerPid)) {
      roots.set(daemon.brokerPid, { kind: 'broker' });
    }
  }

  // Then a direct child of Kabmo that the registry did not claim: an omp
  // session host (its argv says which kind), or a PTY shell.
  for (const process of list) {
    if (process.ppid !== options.serverPid || roots.has(process.pid)) continue;
    const line = (process.argv ?? []).join(' ');
    if (line.includes('--mode rpc-ui')) {
      // The LEASE decides session-vs-prewarm, never argv: a host that adopted a
      // prewarm keeps the prewarm's argv for its whole life, so argv alone
      // reported three live sessions as idle hosts.
      const kind: GroupKind = process.argv?.includes('--no-session')
        ? 'utility'
        : options.leases?.get(process.pid)
          ? 'session'
          : (process.argv ?? []).some((value) => value === '--resume')
            ? 'session'
            : 'prewarm';
      roots.set(process.pid, { kind });
      continue;
    }
    if (process.argv?.[1] === '-i') {
      roots.set(process.pid, { kind: 'terminal' });
    }
  }

  return roots;
}

/**
 * Assign every process to a group, by walking its chain to the nearest root.
 *
 * One pass with memoisation: a chain already resolved is reused, so a deep
 * subtree is walked once rather than once per leaf. The walk is iterative and
 * guarded against a pid cycle, which a recycled pid can produce.
 */
export function assignGroups(
  list: readonly ProcessInfo[],
  options: GroupOptions,
): Map<number, GroupAssignment> {
  const byPid = new Map(list.map((process) => [process.pid, process]));
  const roots = rootsOf(list, options);
  const resolved = new Map<number, GroupAssignment>();

  for (const process of list) {
    if (resolved.has(process.pid)) continue;
    const chain: ProcessInfo[] = [];
    const seen = new Set<number>();
    let cursor: ProcessInfo | undefined = process;

    while (cursor && !seen.has(cursor.pid) && !resolved.has(cursor.pid)) {
      seen.add(cursor.pid);
      chain.push(cursor);
      if (cursor.pid === options.serverPid) break;
      const root = roots.get(cursor.pid);
      if (root) break;
      cursor = byPid.get(cursor.ppid);
    }

    // The owner is whichever the walk stopped at. `chain` holds every process
    // visited INCLUDING the stop point (the push precedes the break test), so
    // `chain[chain.length - 1]` is the owner itself in the root and server
    // cases, and the owner's child in the already-resolved case.
    let key: string;
    let ownerPid: number;
    let kind: GroupKind;
    let baseDepth: number;

    if (cursor && resolved.has(cursor.pid)) {
      // Stopped at an ANCESTOR ALREADY RESOLVED. It is not in the chain, and
      // its assignment is this chain's base — reusing it is what makes a deep
      // subtree cost one walk rather than one per leaf.
      const found = resolved.get(cursor.pid)!;
      key = found.key;
      ownerPid = found.ownerPid;
      kind = found.kind;
      baseDepth = found.depth + 1;
    } else if (cursor && cursor.pid === options.serverPid) {
      key = 'kabmo';
      ownerPid = options.serverPid;
      kind = 'kabmo';
      baseDepth = 0;
    } else if (cursor) {
      const root = roots.get(cursor.pid);
      key = root?.name ? `daemon:${root.name}` : `${root?.kind ?? 'other'}:${cursor.pid}`;
      ownerPid = cursor.pid;
      kind = root?.kind ?? 'other';
      baseDepth = 0;
    } else {
      // The chain ran off the table: a process whose ancestor exited mid-sweep.
      // It keeps its own group rather than vanishing.
      key = 'other';
      ownerPid = 0;
      kind = 'other';
      baseDepth = 0;
    }

    const assignment: GroupAssignment = { key, ownerPid, depth: 0, kind };
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      resolved.set(chain[index].pid, { ...assignment, depth: baseDepth + (chain.length - 1 - index) });
    }
  }

  return resolved;
}
