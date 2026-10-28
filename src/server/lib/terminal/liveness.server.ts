/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which shells are live, and which of them are doing work.
 *
 * Split from the registry that mutates them (`runtime.server.ts`) because the
 * question is asked from outside the socket: the terminal inventory endpoint
 * ("which shells can this client adopt?"), and the capacity check that runs
 * before a new shell is created. Both ask it about every session at once, so
 * both pay for one `ps` rather than one per shell.
 *
 * Two kinds of session are deliberately excluded from `countLiveTerminals`: an
 * exited shell (a corpse with a scrollback nobody is reading) and a shell
 * sitting at its prompt — the PTY's foreground process group tells them apart
 * exactly (see `foreground.ts`). Counting idle shells is how a panel that was
 * restarted or switched a few times pins the budget with nothing running, and
 * the next attach is refused.
 *
 * WINDOWS HAS NO FOREGROUND GROUP, SO THE CAP BOUNDS EVERY LIVE SHELL THERE.
 * `detectBusyShells` answers "nothing is busy" on Windows because a ConPTY
 * exposes no `tpgid` — and a cap built on that answer never fires: measured
 * against the old shape, `countLiveTerminals()` returned 0 with eight shells
 * open, so `MAX_TERMINALS` was unreachable and a client could open shells
 * without limit. A bound that never triggers is not a bound, so the two
 * questions are separated here: `busy` stays "what the platform knows" (the
 * panel's badge), while the CAP falls back to every running shell when the
 * platform cannot distinguish idle from busy. That over-counts idle shells on
 * Windows — a panel reopened a few times reaches the limit sooner — which is
 * the conservative direction: a refused attach is recoverable, an unbounded
 * shell count is not.
 */

import path from 'path';
import { detectBusyShells, type ShellProcess } from '@/server/lib/terminal/foreground';
import { snapshotOf } from '@/server/lib/terminal/session.server';
import { terminalStore } from '@/server/lib/terminal/store';
import type { TerminalSnapshot } from '@/shared/lib/workspace/terminal/protocol';

/** Overridable so the Windows branch is reachable from a POSIX test. */
export interface LivenessOptions {
  platform?: NodeJS.Platform;
}

/**
 * True when this platform can tell an idle shell from one running a command.
 *
 * Only the distinction is platform-bound; counting running shells is not. The
 * two answers must not be conflated, because one of them is a UI badge and the
 * other is a limit.
 */
export function distinguishesIdleShells(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32';
}

/** Shells that are actually doing work, which is what the cap budgets. */
export async function countLiveTerminals(options: LivenessOptions = {}): Promise<number> {
  const platform = options.platform ?? process.platform;
  const running: ShellProcess[] = [];
  for (const session of terminalStore().sessions.values()) {
    if (session.status !== 'running' || !session.proc) continue;
    running.push({ id: session.id, pid: session.proc.pid });
  }

  // No foreground-group question to ask: every live shell occupies a slot.
  if (!distinguishesIdleShells(platform)) return running.length;

  const busy = await detectBusyShells(running, { platform });
  return busy.size;
}

/**
 * Live terminal summaries, optionally narrowed to one scope, so a client can
 * adopt a shell it does not have an id for (a reloaded page, a second tab).
 *
 * `busy` marks a shell with a foreground command — the panel shows it as
 * running, and the cap budgets it.
 */
export async function listTerminals(root?: string | null, repo?: string | null): Promise<TerminalSnapshot[]> {
  const scope = root ? (repo && repo !== '.' ? path.join(root, repo) : root) : null;
  // Resolved once: a scope boundary either ends in a separator already or gets
  // one, so a sibling directory that merely shares the prefix (`/a/bc`) is not
  // read as being inside `/a/b`.
  const scopePrefix = scope && !scope.endsWith(path.sep) ? scope + path.sep : scope;

  const running: ShellProcess[] = [];
  const out: TerminalSnapshot[] = [];
  for (const session of terminalStore().sessions.values()) {
    if (scopePrefix && session.cwd !== scope && !session.cwd.startsWith(scopePrefix)) continue;
    if (session.status === 'running' && session.proc) {
      running.push({ id: session.id, pid: session.proc.pid });
    }
    out.push(snapshotOf(session));
  }
  const busy = await detectBusyShells(running);
  return out.map((snapshot) => ({ ...snapshot, busy: busy.has(snapshot.id) }));
}
