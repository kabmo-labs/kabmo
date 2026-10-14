/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which process is which, from argv, the parent map, and omp's daemon registry.
 *
 * Every rule here is derivable from what a foreign process exposes — no
 * chamber-internal registry is read, because a plugin cannot import the host's
 * source and should not depend on its private shape. argv is enough:
 *
 * | Category | How it is recognised | Verified against |
 * |---|---|---|
 * | `chamber` | argv contains `--ompchamber-server` | pid 86296 |
 * | `omp` | argv contains `--mode rpc-ui` | pids 16175, 16575, 20219 |
 * | `daemon` | the pid, or an ancestor's, is in omp's daemon registry | pid 62457 (broker), 6765 (browser) |
 * | `terminal` | a SHELL that is a direct child of the chamber | the PTY shim's `exec /bin/zsh -i` |
 * | `dictation` | argv contains `__omp_worker_stt` | the STT worker's own spawn |
 * | `tray` | argv names a tray host script | `osascript …/darwin.js` |
 * | `other` | everything else | — |
 *
 * Two of those rules are worth stating because the obvious version is wrong:
 *
 * - **`terminal` keys on the PARENT, not on the executable.** An omp child runs
 *   `bash` constantly, so "is a shell" would label every tool call a terminal.
 *   The PTY shells are the ones the chamber spawned directly — `detached: true`
 *   keeps their ppid the server's, and the shim `exec`s into the shell so the
 *   argv is a plain `/bin/zsh -i` with nothing else to distinguish it.
 * - **A daemon is matched by ANCESTRY.** The broker is the registered pid, but
 *   the thing that costs memory is its Chromium grandchildren, so the daemon
 *   label propagates down the subtree and the row is named after the daemon
 *   (`omp.browser.headless`).
 *
 * A process whose argv cannot be read (another user's, a kernel thread, one that
 * exited mid-sweep) is still counted — as `other`, named by whatever the
 * executable path gives. Dropping it would make the total a lie.
 */

import type { ProcessInfo } from './proc/types';

/** The buckets the panel groups by. `daemon:<name>` carries omp's own daemon name. */
export type ProcessCategory =
  | 'chamber'
  | 'omp'
  | 'terminal'
  | 'dictation'
  | 'tray'
  | 'other'
  | `daemon:${string}`;

/** One daemon omp's registry reports, with its live pid. */
export interface DaemonEntry {
  /** The daemon's own name, e.g. `omp.browser.headless`. */
  name: string;
  pid: number;
  state: string;
  /** The project the runtime dir belongs to, from `scope.json`. */
  projectDir: string;
  /** The broker supervising it, from `broker.pid`. */
  brokerPid: number | null;
}

/** The argv of a process joined for a substring test. */
function commandLine(argv: readonly string[] | null): string {
  return argv ? argv.join(' ') : '';
}

/**
 * Whether a process is one of the PTY shells the chamber spawned.
 *
 * `shellNames` is the set the terminal resolves, and the parent test is what
 * separates a terminal from a `bash` a tool call started: those are grandchildren
 * of the server, never children.
 */
function isTerminalShell(process: ProcessInfo, serverPid: number, shellNames: readonly string[]): boolean {
  if (process.ppid !== serverPid) return false;
  const executable = process.argv?.[0];
  if (!executable) return false;
  const base = executable.slice(executable.lastIndexOf('/') + 1);
  return shellNames.includes(base);
}

/** Whether argv names one of the tray host scripts. */
function isTrayHost(argv: readonly string[] | null): boolean {
  if (!argv) return false;
  const line = argv.join(' ');
  return /\/(darwin|linux)\.js\b/.test(line) || /win32\.ps1\b/.test(line) || /\btray-\d+\.pid\b/.test(line);
}

export interface ClassifyOptions {
  /** The chamber's own pid — the tree root and the terminal-parent test. */
  serverPid: number;
  /** Shell basenames the terminal may have launched. */
  shellNames: readonly string[];
  /** Every daemon the registry reports, by pid. */
  daemons: readonly DaemonEntry[];
}

/**
 * Attribute every process in `list` to a category, by its own argv first and by
 * its nearest labelled ancestor second.
 *
 * One pass over the parent map rather than a recursive walk per process: a
 * process whose parent is not in `list` (it exited mid-sweep, or it is outside
 * the tree) simply keeps its own answer.
 */
export function classifyProcesses(
  list: readonly ProcessInfo[],
  options: ClassifyOptions,
): Map<number, ProcessCategory> {
  const byPid = new Map<number, ProcessInfo>();
  for (const process of list) byPid.set(process.pid, process);

  // A daemon's registered pid is the anchor its whole subtree inherits — and so
  // is its BROKER's, because the broker is the process the registry names while
  // the daemon is the thing it supervises. A broker serving several daemons is
  // labelled by the first one, which is what a reader wants: the broker is that
  // machinery, and splitting it across names would double-count one process.
  const daemonByPid = new Map<number, string>();
  for (const daemon of options.daemons) {
    daemonByPid.set(daemon.pid, daemon.name);
    if (daemon.brokerPid !== null && !daemonByPid.has(daemon.brokerPid)) {
      daemonByPid.set(daemon.brokerPid, daemon.name);
    }
  }

  const own = new Map<number, ProcessCategory>();
  for (const process of list) {
    // The tree root IS the chamber — the sampler was handed that pid. Deciding
    // it from argv instead made the label depend on how the server was
    // launched: a wrapper (`bun run src/server/index.ts`) or a different entry
    // point would drop the chamber's own row into `other`, and the one process
    // a reader looks for first would be unlabelled.
    if (process.pid === options.serverPid) {
      own.set(process.pid, 'chamber');
      continue;
    }
    const daemon = daemonByPid.get(process.pid);
    if (daemon) {
      own.set(process.pid, `daemon:${daemon}`);
      continue;
    }
    const line = commandLine(process.argv);
    if (line.includes('--ompchamber-server')) {
      own.set(process.pid, 'chamber');
      continue;
    }
    if (line.includes('__omp_worker_stt')) {
      own.set(process.pid, 'dictation');
      continue;
    }
    if (isTrayHost(process.argv)) {
      own.set(process.pid, 'tray');
      continue;
    }
    if (line.includes('--mode rpc-ui')) {
      own.set(process.pid, 'omp');
      continue;
    }
    if (isTerminalShell(process, options.serverPid, options.shellNames)) {
      own.set(process.pid, 'terminal');
      continue;
    }
    own.set(process.pid, 'other');
  }

  // Second pass: an unlabelled process inherits the nearest ancestor's label.
  // Iterative rather than recursive so a deep tree cannot blow the stack, and
  // memoised so a shared ancestor is resolved once.
  const resolved = new Map<number, ProcessCategory>();
  for (const process of list) {
    const chain: ProcessInfo[] = [];
    let cursor: ProcessInfo | undefined = process;
    const seen = new Set<number>();
    while (cursor && !resolved.has(cursor.pid) && !seen.has(cursor.pid)) {
      seen.add(cursor.pid);
      chain.push(cursor);
      const own0 = own.get(cursor.pid);
      // A process with a category of its OWN stops the walk: `other` is a real
      // answer for a leaf, but an ancestor's label is more informative than
      // `other`, which is why the walk exists at all.
      if (own0 && own0 !== 'other') break;
      cursor = byPid.get(cursor.ppid);
    }
    // The walk stopped either at a labelled process (handled below, walking
    // back down the chain) or at an ANCESTOR ALREADY RESOLVED by an earlier
    // iteration — and that ancestor's answer is this chain's base. Seeding from
    // it is not an optimisation: without it the chain would be treated as
    // having no labelled ancestor at all, so a `bash` under an omp child read
    // as `other` whenever the omp child happened to be visited first.
    let inherited: ProcessCategory = cursor ? (resolved.get(cursor.pid) ?? 'other') : 'other';
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const candidate = own.get(chain[i].pid);
      if (candidate && candidate !== 'other') inherited = candidate;
      resolved.set(chain[i].pid, inherited);
    }
  }
  return resolved;
}
