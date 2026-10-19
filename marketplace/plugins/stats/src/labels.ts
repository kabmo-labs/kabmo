/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a row SAYS: a human title, and the context under it.
 *
 * The panel used to print one column — the executable's basename — and that
 * made twelve of the forty-odd rows unreadable: `node` ten times, `cli.js` six,
 * `omp` five. Every one of those distinctions is already in argv (and in the
 * cwd, and in the session lease), so the label is a pure function of data the
 * sweep already read. Nothing here spawns a process or reads a registry the
 * host owns.
 *
 * ## Two rules that are not obvious
 *
 * - **The lease beats argv for a session host.** argv is fixed at spawn, and
 *   `buildSessionSpawnArgs('')` carries no `--resume`, so a host that ADOPTED a
 *   prewarm keeps the prewarm's argv forever. Measured on this machine: three
 *   rows that read as idle prewarms were live sessions with titles and hundreds
 *   of messages. The lease is the only thing that tells them apart.
 * - **A prewarm and a utility are DIFFERENT states, not one "no session".** A
 *   prewarm is a full session host waiting for a first send; a utility child
 *   (`--no-session --no-lsp`) answers registry queries and never hosts a
 *   conversation. Saying "no session" for both hides which one is idle capacity
 *   and which one is machinery.
 *
 * ## Age is part of the detail, always
 *
 * A row that has been alive for two hours is a different fact from one spawned
 * a minute ago, and only the start time separates them — so it is appended to
 * every detail line rather than left to a column the reader has to cross-
 * reference.
 */

import os from 'node:os';

import type { ProcessInfo } from './proc/types';
import { sessionFileForId, titleForSessionFile, sessionIdFromPath, lastWriteMs } from './sessions';

/** A row's two lines. */
export interface ProcessLabel {
  /** The bold line: what this process IS. */
  title: string;
  /** The muted line: project, identity, age. */
  detail: string;
}

/** What `describeProcess` needs beyond the process itself. */
export interface LabelContext {
  /** Wall clock, so age is computed once per sample. */
  now: number;
  /**
   * The Kabmo's own pid, when the caller knows it.
   *
   * The tree root IS Kabmo, decided by identity rather than argv: a
   * `bun run src/server/index.ts` boot (dev) carries no `--kabmo-server`,
   * and reading the label off argv made the one row a reader looks for first
   * render as `index.ts`.
   */
  serverPid?: number;
  /**
   * The session lease this pid holds, when the caller read one.
   *
   * Passed in rather than probed here because the walk is per-pid and the
   * sampler already iterates the processes it keeps.
   */
  lease?: string | null;
}

const RUNTIMES = new Set(['bun', 'node']);

/** `run`/`exec`/`x` are subcommands; the script is the argument after them. */
const SUBCOMMANDS = new Set(['run', 'exec', 'x', 'test']);

/** The last path segment, or the value itself when it has none. */
function basename(value: string): string {
  const cut = value.lastIndexOf('/');
  return cut === -1 ? value : value.slice(cut + 1);
}

/**
 * The executable a row shows, with the runtime unwrapped.
 *
 * A `bun` process's argv head is the runtime, not the program, so the SECOND
 * argument is the honest name when the first is a known runtime and the second
 * is a script path. Without this every omp child, the broker and Kabmo
 * itself read as `bun`.
 *
 * `bun run <script>` needs one more step: the second argument is the
 * subcommand (`run`), not the program, so a label taken there names every
 * `bun run` process `run`. The first non-flag argument AFTER the subcommand is
 * the script — which is the same rule, applied one position later.
 */
export function commandLabel(process: ProcessInfo): string {
  const argv = process.argv;
  if (!argv || argv.length === 0) return '?';
  const head = basename(argv[0]);
  if (!RUNTIMES.has(head)) return head;
  let index = 1;
  if (argv[index] !== undefined && SUBCOMMANDS.has(argv[index])) index += 1;
  const candidate = argv[index];
  // `-e` / `-p` / any flag means there is no script to name; keep the runtime.
  if (candidate === undefined || candidate.startsWith('-')) return head;
  return basename(candidate);
}

/** The project a directory belongs to: its basename, with `~` for the home. */
export function projectOf(cwd: string | null): string | null {
  if (!cwd) return null;
  if (cwd === os.homedir()) return '~';
  return basename(cwd) || null;
}

/** The argv operand after `flag`, or null. */
function argOf(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index === -1 ? null : (argv[index + 1] ?? null);
}

/**
 * A span in the form the panel shows: `2h18m`, `54m`, `12s`.
 *
 * Empty when the start time is unknown, so a caller can drop the segment rather
 * than print a placeholder that reads as "just started".
 */
export function formatSpan(startedAt: number, now: number): string {
  if (!Number.isFinite(startedAt) || startedAt <= 0) return '';
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d${String(hours % 24).padStart(2, '0')}h`;
}

/** The segments of a detail line, with the empty ones dropped. */
function detailOf(parts: (string | null | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

/**
 * The title and detail for one process.
 *
 * Ordered by specificity: the most particular recognition wins, so a daemon
 * broker is never labelled by the `cli.js` its argv would otherwise give it.
 */
export function describeProcess(process: ProcessInfo, context: LabelContext): ProcessLabel {
  const argv = process.argv ?? [];
  const line = argv.join(' ');
  const age = formatSpan(process.startedAt, context.now);
  const project = projectOf(process.cwd);
  const cwdArg = projectOf(argOf(argv, '--cwd'));

  if (line.includes('--kabmo-server') || (context.serverPid !== undefined && process.pid === context.serverPid)) {
    return { title: 'Kabmo server', detail: detailOf(['the server itself', age]) };
  }
  if (line.includes('__omp_worker_daemon_broker')) {
    return { title: 'daemon broker', detail: detailOf([project, age]) };
  }
  if (line.includes('__omp_worker_lsp_mux')) {
    return { title: 'LSP mux', detail: detailOf([project, age]) };
  }
  if (line.includes('__omp_worker_js_eval_process')) {
    return { title: 'js-eval sandbox', detail: age };
  }
  if (line.includes('__omp_worker_stt')) {
    return { title: 'dictation worker', detail: age };
  }
  if (line.includes('browser-relay')) {
    const port = argOf(argv, '--port');
    return { title: `browser relay${port ? ` :${port}` : ''}`, detail: age };
  }
  if (line.includes('codegraph')) {
    return argv.some((value) => value.includes('--mcp'))
      ? { title: `codegraph MCP${project ? ` · ${project}` : ''}`, detail: detailOf(['--mcp', age]) }
      : { title: 'codegraph watchdog', detail: age };
  }
  if (line.includes('--mode rpc-ui')) {
    if (argv.includes('--no-session')) {
      return { title: 'omp utility', detail: detailOf([cwdArg ?? project, 'registry queries', age]) };
    }
    // The lease first: a host that adopted a prewarm never gained a `--resume`.
    const resume = argOf(argv, '--resume');
    const id = context.lease ?? (resume ? sessionIdFromPath(resume) : null);
    if (id) {
      const file = sessionFileForId(id);
      const title = file ? titleForSessionFile(file) : null;
      const short = id.slice(0, 8);
      const wrote = file ? lastWriteMs(file) : null;
      const ago = wrote ? formatSpan(wrote, context.now) : '';
      return {
        title: title ?? `session ${short}`,
        detail: detailOf([short, cwdArg ?? project, ago ? `wrote ${ago} ago` : null]),
      };
    }
    return { title: 'prewarm (idle host)', detail: detailOf([cwdArg ?? project, 'no session', age]) };
  }
  if (line.includes('typescript-language-server')) {
    return { title: `LSP${project ? ` · ${project}` : ''}`, detail: age };
  }
  if (line.includes('tsserver.js')) {
    return { title: `tsserver${project ? ` · ${project}` : ''}`, detail: age };
  }
  if (line.includes('typingsInstaller.js')) {
    return { title: 'typings installer', detail: age };
  }
  if (line.includes('Google Chrome for Testing')) {
    const type = (argv.find((value) => value.startsWith('--type=')) ?? '--type=browser').replace('--type=', '');
    return { title: `Chromium ${type}`, detail: age };
  }
  if (argv[1] === '-i') {
    return { title: `shell${project ? ` · ${project}` : ''}`, detail: detailOf(['pty', age]) };
  }

  return { title: commandLabel(process), detail: detailOf([project, age]) };
}
