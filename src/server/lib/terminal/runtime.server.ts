/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The terminal registry: creation, attachment, input, resize and reaping.
 *
 * One real shell per terminal id, created on the first `attach` (there is no
 * separate create endpoint to race against), kept alive while clients come and
 * go, and killed through the process group so the commands it started die with
 * it. Session mechanics live in `session.server.ts`, the process-wide state in
 * `store.ts`, and the liveness questions in `liveness.server.ts`.
 */

import { countLiveTerminals } from '@/server/lib/terminal/liveness.server';
import {
  TERMINATION_GRACE_MS,
  TerminalRuntimeError,
  closeTerminalStream,
  createSession,
  signalGroup,
  snapshotOf,
  type AttachRequest,
  type TerminalSession,
  type TerminalViewer,
} from '@/server/lib/terminal/session.server';
import { terminalStore } from '@/server/lib/terminal/store';
import { TERMINAL_MAX_INPUT_BYTES, clampTerminalSize, type TerminalSnapshot } from '@/shared/lib/workspace/terminal/protocol';

const MAX_TERMINALS = 8;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const IDLE_SWEEP_MS = 60 * 1000;
/** Quiet period before a resize burst is committed to the PTY. */
const RESIZE_SETTLE_MS = 120;

export interface TerminalAttachment {
  snapshot: TerminalSnapshot;
  /** Retained scrollback, to be sent after the `ready` frame. */
  replay: Uint8Array;
}

/** The process-wide state; see `store.ts` for why it is not module-local. */
const registry = terminalStore();
const sessions = registry.sessions;
const resizeTimers = registry.resizeTimers;

/**
 * Attach `viewer` to `request.id`, creating the shell when the id is unknown.
 *
 * Registration and history capture happen in one synchronous block: Bun cannot
 * interleave a PTY `data` callback inside it, so the viewer can neither miss
 * output nor receive it twice.
 */
export async function attachTerminal(viewer: TerminalViewer, request: AttachRequest): Promise<TerminalAttachment> {
  const session = await openTerminal(request);

  const replay = session.history.replay();
  const snapshot = snapshotOf(session);
  session.viewers.add(viewer);
  session.lastActivity = Date.now();
  return { snapshot, replay };
}

/**
 * The shell for `request.id`, creating it at most once.
 *
 * Creation awaits — cwd resolution, the shell probe, the cap's `ps` — so two
 * `attach` frames for the same new id both used to pass the `sessions.get`
 * check and both spawned a shell. The map kept whichever landed last and the
 * other became unreachable: a PTY plus a detached shell with no record, which
 * the reaper could never reclaim and the cap never counted. Measured on this
 * runtime: two concurrent attaches for one id left two shells for one record.
 * A page reload racing its own reconnect is enough to produce that.
 *
 * Sharing the in-flight promise makes the loser await the winner's session
 * instead of creating a rival. The map lives in `store.ts` beside the records,
 * because a reload that dropped it would reopen the same race.
 */
async function openTerminal(request: AttachRequest): Promise<TerminalSession> {
  const existing = sessions.get(request.id);
  if (existing) return existing;

  const inFlight = registry.creating.get(request.id);
  if (inFlight) return inFlight;

  const entry = createTerminal(request);
  registry.creating.set(request.id, entry);
  const release = () => {
    if (registry.creating.get(request.id) === entry) registry.creating.delete(request.id);
  };
  void entry.then(release, release);
  return entry;
}

/**
 * Spawn one shell, register it, and arm the reaper.
 *
 * The cap counts *live* shells only. An exited shell is a corpse holding a
 * scrollback nobody is reading, and letting corpses consume the budget is how
 * a session that restarted a shell a few times hits the limit with nothing
 * running: every restart leaves its predecessor behind.
 */
async function createTerminal(request: AttachRequest): Promise<TerminalSession> {
  reclaimExitedTerminals();
  if ((await countLiveTerminals()) >= MAX_TERMINALS) {
    throw new TerminalRuntimeError('capacity', `Terminal limit reached (${MAX_TERMINALS} busy shells)`);
  }
  const created = await createSession(request);
  sessions.set(request.id, created);
  // An exit with nobody watching is the common case for a replaced shell
  // (restart, repo switch): reap it as soon as it lands instead of leaving
  // the record for the sweep, which is up to a minute of holding a slot.
  void created.proc?.exited.then(() => {
    if (created.viewers.size === 0) forgetTerminal(created.id);
  });
  ensureSweeper();
  return created;
}

/**
 * Drop exited shells that nobody is watching.
 *
 * Run before a create, not only on the idle sweep: the sweep is a minute away,
 * and a burst of restarts inside that window would otherwise be rejected while
 * every corpse in the way is already dead.
 */
export function reclaimExitedTerminals(): number {
  let reclaimed = 0;
  for (const [id, session] of sessions) {
    if (session.status !== 'exited') continue;
    if (session.viewers.size > 0) continue;
    forgetTerminal(id);
    reclaimed += 1;
  }
  return reclaimed;
}

export function detachTerminal(viewer: TerminalViewer, id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.viewers.delete(viewer);
  session.lastActivity = Date.now();
  // The last viewer leaving a finished shell leaves nothing behind worth
  // keeping: no process to reattach to, and a scrollback nobody will read.
  if (session.status === 'exited' && session.viewers.size === 0) forgetTerminal(id);
}

export function writeTerminalInput(id: string, data: Uint8Array): void {
  const session = sessions.get(id);
  if (!session || session.status !== 'running') return;
  if (data.length === 0 || data.length > TERMINAL_MAX_INPUT_BYTES) return;
  session.lastActivity = Date.now();
  try {
    session.term.write(data);
  } catch {
    // The PTY closed between the status check and the write.
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session || session.status !== 'running') return;
  const size = clampTerminalSize(cols, rows);
  if (size.cols === session.cols && size.rows === session.rows) return;
  session.cols = size.cols;
  session.rows = size.rows;
  session.lastActivity = Date.now();
  try {
    session.term.resize(size.cols, size.rows);
  } catch {
    return;
  }
  // resize() updates the winsize but never signals the child, so a TUI would
  // not repaint. Deliver SIGWINCH ourselves.
  signalGroup(session, 'SIGWINCH');
}

/**
 * Debounce for `resizeTerminal`.
 *
 * A panel drag produces a burst of sizes — the pointer moves in steps and
 * xterm's FitAddon refits on every animation frame — and each accepted size
 * sends SIGWINCH. The shell answers every one of them by redrawing its prompt,
 * so a single drag used to print the prompt a dozen times (measured: 10
 * SIGWINCH in one second for one drag).
 *
 * Only the trailing size matters: the PTY ends at the final grid either way,
 * and a repaint of an intermediate size is invisible work. A single timeout is
 * reused so the burst coalesces into one signal.
 */
export function resizeTerminalDebounced(id: string, cols: number, rows: number): void {
  const pending = resizeTimers.get(id);
  if (pending) clearTimeout(pending);
  resizeTimers.set(
    id,
    setTimeout(() => {
      resizeTimers.delete(id);
      resizeTerminal(id, cols, rows);
    }, RESIZE_SETTLE_MS),
  );
}

/**
 * Kill the shell for `id`, keeping the record and its viewers: the process exit
 * is what reports the real exit code, so nothing is synthesized here.
 *
 * SIGHUP, not SIGTERM. An interactive shell ignores SIGTERM — verified on
 * macOS: `kill -TERM` to a zsh process group left it alive indefinitely, while
 * SIGHUP terminated it in ~150 ms along with its background jobs. SIGHUP is
 * also the semantically right signal: the terminal is going away.
 */
export function closeTerminal(id: string): void {
  const session = sessions.get(id);
  if (!session || session.status !== 'running') return;
  signalGroup(session, 'SIGHUP');
  setTimeout(() => {
    if (session.status === 'running') signalGroup(session, 'SIGKILL');
  }, TERMINATION_GRACE_MS).unref?.();
}

/**
 * Drop a session record and release its PTY stream. Used by the idle reaper and
 * when a client closes a terminal it does not intend to reopen — there are no
 * viewers left to inform, so a running shell is killed outright.
 */
export function forgetTerminal(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  clearPendingResize(id);
  // Close each viewer's socket, not just forget it: the record is going away,
  // so a socket left open would sit on a terminal that can never answer it.
  for (const viewer of session.viewers) viewer.drop();
  session.viewers.clear();
  if (session.status === 'running') signalGroup(session, 'SIGKILL');
  closeTerminalStream(session);
}

function clearPendingResize(id: string): void {
  const pending = resizeTimers.get(id);
  if (pending) {
    clearTimeout(pending);
    resizeTimers.delete(id);
  }
}

/**
 * Kill every shell at process exit. Synchronous by contract — `exit` handlers
 * cannot await — so it escalates straight to SIGKILL: a detached shell is its
 * own session and would otherwise outlive the server.
 */
export function disposeAllTerminals(): void {
  clearInterval(registry.sweep);
  registry.sweep = undefined;
  for (const [id, session] of sessions) {
    clearPendingResize(id);
    session.viewers.clear();
    signalGroup(session, 'SIGKILL');
    closeTerminalStream(session);
  }
  sessions.clear();
}

function ensureSweeper(): void {
  if (registry.sweep !== undefined) return;
  registry.sweep = setInterval(() => {
    // Exited shells are reaped on exit and on detach; this catches the one
    // that finished while a viewer was still attached to it.
    reclaimExitedTerminals();
    const now = Date.now();
    for (const [id, session] of sessions) {
      // A live shell is only reaped when nobody watches it: an attached
      // terminal is idle by definition while the user reads its output.
      if (session.viewers.size > 0) continue;
      if (now - session.lastActivity < IDLE_TIMEOUT_MS) continue;
      forgetTerminal(id);
    }
  }, IDLE_SWEEP_MS);
  registry.sweep.unref?.();
}

/**
 * Register process-wide cleanup exactly once. A `bun --hot` reload re-evaluates
 * this module while the shells live on, so the guard keeps a reload from
 * stacking duplicate signal handlers. It rides the same store as the registry,
 * which is what makes it survive the reload that would otherwise reset it.
 */
if (!registry.cleanupInstalled) {
  registry.cleanupInstalled = true;
  process.once('exit', disposeAllTerminals);
  process.once('SIGINT', disposeAllTerminals);
  process.once('SIGTERM', disposeAllTerminals);
}
