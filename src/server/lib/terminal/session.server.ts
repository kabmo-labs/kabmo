/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One PTY-backed shell: how it is created, how it is signalled, and what a
 * snapshot of it looks like.
 *
 * Three behaviours here are load-bearing and were verified against Bun 1.4.2.
 * Each fails *silently* when broken, which is why they are stated rather than
 * implied by the code:
 *
 * 1. **`detached: true` is mandatory — on POSIX.** Without it the child stays in
 *    the server's own process group: an interactive shell reports "no job
 *    control in this shell" (Ctrl+Z and `fg` stop working), `process.kill(-pid, …)`
 *    fails with ESRCH, and a group signal aimed at the *server's* group would
 *    take Kabmo down with it. **Windows is the exception and must NOT
 *    detach**: there `detached` becomes `DETACHED_PROCESS`, the child gets no
 *    console at all, and `cmd.exe` exits 1 immediately (measured on the CI
 *    runner — every shell `status: "exited"`). Windows has no process group to
 *    address; `killProcessTree` uses `taskkill /t`.
 * 2. **The shell must re-acquire the PTY as its controlling terminal.** `setsid`
 *    drops it, and a shell without one disables job control regardless of
 *    `-i`. `shellLaunch` performs the re-open; see that module.
 * 3. **`Bun.Terminal.resize()` never signals the child** — it updates the
 *    kernel winsize only, so a TUI would not repaint. The caller sends
 *    SIGWINCH itself.
 *
 * A fourth: a PTY read may split a multi-byte character, so bytes are forwarded
 * verbatim and xterm's own streaming decoder reassembles them.
 */

import { resolveRoot } from '@/server/lib/fs/root';
import { scopeToRepo } from '@/server/lib/fs/repo-scope';
import { describeSpawnFailure } from '@/server/lib/lifecycle/fd-pressure';
import { killProcessTree } from '@/server/lib/lifecycle/kill-tree';
import { createTerminalHistory, type TerminalHistory } from '@/server/lib/terminal/history';
import { resolveShellExecutable, shellCandidates, shellLaunch, terminalEnv } from '@/server/lib/terminal/shell';
import { shellSpawnOptions } from '@/server/lib/terminal/spawn';
import {
  clampTerminalSize,
  type TerminalErrorCode,
  type TerminalSnapshot,
} from '@/shared/lib/workspace/terminal/protocol';

export const TERMINATION_GRACE_MS = 1000;

/** A socket attached to a terminal. Output is raw PTY bytes; control is JSON. */
export interface TerminalViewer {
  /**
   * Deliver one frame. Returns false when the viewer could not accept it —
   * the socket's send buffer is over its high-water mark — which the session
   * treats as "this viewer is gone": a PTY producer cannot be paused, so the
   * alternative is buffering unbounded output in a socket nobody is reading.
   */
  send(frame: string | Uint8Array): boolean;
  /** Detach this viewer. Called when `send` reports it cannot keep up. */
  drop(): void;
}

export interface TerminalSession {
  id: string;
  cwd: string;
  shell: string;
  term: Bun.Terminal;
  proc: Bun.Subprocess | null;
  history: TerminalHistory;
  viewers: Set<TerminalViewer>;
  cols: number;
  rows: number;
  /** Grid the retained scrollback was drawn for — replay must match it. */
  replayCols: number;
  replayRows: number;
  status: 'running' | 'exited';
  exitCode: number | null;
  signal: string | null;
  lastActivity: number;
}

/**
 * Deliver `frame` to every viewer, dropping the ones that cannot keep up.
 *
 * `Bun.ServerWebSocket.send` returns the bytes queued, or `-1` when the socket
 * is over its high-water mark and the frame was NOT sent (verified on 1.4.2:
 * 40 sends of 1 MiB to a socket nobody reads all return `-1`). A viewer that
 * reports `-1` is closed rather than skipped — skipping would leave xterm's
 * parser mid-sequence, so the honest outcome is a reconnect that replays the
 * scrollback. The PTY cannot be paused, so this is the only backpressure a
 * terminal has.
 */
export function fanOut(session: TerminalSession, frame: string | Uint8Array): void {
  for (const viewer of session.viewers) {
    if (viewer.send(frame)) continue;
    session.viewers.delete(viewer);
    viewer.drop();
  }
}

/** A rejected attach, carrying the code the client shows to the user. */
export class TerminalRuntimeError extends Error {
  constructor(
    readonly code: TerminalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TerminalRuntimeError';
  }
}

export interface AttachRequest {
  id: string;
  cols: number;
  rows: number;
  root?: string;
  repo?: string;
  theme?: 'light' | 'dark';
}

export async function createSession(request: AttachRequest): Promise<TerminalSession> {
  const cwd = await resolveSessionCwd(request.root, request.repo);
  const executable = await resolveShellExecutable(shellCandidates());
  if (!executable) {
    throw new TerminalRuntimeError('shell', 'No usable shell found (checked $SHELL, /bin/zsh, /bin/bash, /bin/sh)');
  }

  const size = clampTerminalSize(request.cols, request.rows);
  const session: TerminalSession = {
    id: request.id,
    cwd,
    shell: executable,
    // Assigned below: the PTY callback closes over `session`, so the record has
    // to exist before the terminal does.
    term: undefined as unknown as Bun.Terminal,
    proc: null,
    history: createTerminalHistory(),
    viewers: new Set(),
    cols: size.cols,
    rows: size.rows,
    replayCols: size.cols,
    replayRows: size.rows,
    status: 'running',
    exitCode: null,
    signal: null,
    lastActivity: Date.now(),
  };

  const term = new Bun.Terminal({
    cols: size.cols,
    rows: size.rows,
    name: 'xterm-256color',
    data(_term, bytes) {
      session.history.append(bytes);
      session.lastActivity = Date.now();
      fanOut(session, bytes);
    },
  });
  session.term = term;

  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(shellLaunch(executable), shellSpawnOptions({
      terminal: term,
      cwd,
      env: terminalEnv(Bun.env, request.theme ?? 'dark'),
    }));
  } catch (error) {
    closeTerminalStream(session);
    // `describeSpawnFailure` keeps Bun's own message and adds the real cause
    // when the process is out of descriptors — the raw error argues about
    // `/bin/sh`, which is the shim, not the thing that ran out.
    throw new TerminalRuntimeError('spawn', `Failed to start ${executable}: ${describeSpawnFailure(error)}`);
  }
  session.proc = proc;

  void proc.exited.then((code) => {
    if (session.status === 'exited') return;
    session.status = 'exited';
    session.exitCode = code ?? null;
    session.signal = proc.signalCode ?? null;
    session.lastActivity = Date.now();
    const frame = JSON.stringify({ t: 'exit', exitCode: session.exitCode, signal: session.signal });
    fanOut(session, frame);
  });

  return session;
}

async function resolveSessionCwd(root: string | undefined, repo: string | undefined): Promise<string> {
  const baseDir = await resolveRoot(root ?? null, process.cwd());
  let scoped = baseDir;
  try {
    scoped = await scopeToRepo(baseDir, repo ?? null);
  } catch {
    throw new TerminalRuntimeError('cwd', 'Invalid repo path');
  }
  const stat = await Bun.file(scoped).stat().catch(() => null);
  if (!stat?.isDirectory()) throw new TerminalRuntimeError('cwd', `Not a directory: ${scoped}`);
  return scoped;
}

export function snapshotOf(session: TerminalSession): TerminalSnapshot {
  return {
    id: session.id,
    cwd: session.cwd,
    shell: session.shell,
    cols: session.cols,
    rows: session.rows,
    status: session.status,
    exitCode: session.exitCode,
    signal: session.signal,
    bunVersion: Bun.version,
    // `process.version` is the Node version Bun emulates, not a real binary.
    nodeVersion: process.version,
    replayCols: session.replayCols,
    replayRows: session.replayRows,
  };
}

/**
 * Signal the shell's whole process group — and, on Windows, its whole tree.
 *
 * `detached: true` made the shell a session leader on POSIX, so the group holds
 * every command it started: a build, a dev server, a suspended job. Signalling
 * the pid alone would leave those behind, and one of them holding the PTY open
 * keeps the panel attached to a shell that is already dead.
 *
 * Windows has no process group to signal, and this used to fall through to
 * `proc.kill` — the direct child only — which left the same grandchildren
 * running there with nothing to reap them. `killProcessTree` is the module that
 * already solves this for the omp child (`taskkill /t`, falling back to the
 * direct kill), and a shell's foreground command is the same problem.
 */
export function signalGroup(session: TerminalSession, signal: NodeJS.Signals): void {
  const pid = session.proc?.pid;
  if (!pid) {
    // No pid to address, but a handle that can still signal itself. A real
    // `Bun.Subprocess` always has one; this keeps a fake (and a child that has
    // already been reaped) behaving the way it did before the tree kill.
    try {
      session.proc?.kill(signal);
    } catch {
      // Already gone.
    }
    return;
  }
  killProcessTree(pid, signal === 'SIGKILL', signal);
}

export function closeTerminalStream(session: TerminalSession): void {
  try {
    session.term.close();
  } catch {
    // Already closed.
  }
}
