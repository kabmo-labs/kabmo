/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Is a shell busy, or sitting at its prompt?
 *
 * The PTY's foreground process group answers this exactly, and the kernel keeps
 * it up to date: when a command runs in the foreground the terminal's `tpgid`
 * becomes that command's group, and when the shell regains control `tpgid`
 * returns to the shell's own pid. Verified on macOS against a real PTY —
 * `sleep 30` moved `tpgid` off the shell's pid, `Ctrl+C` and a backgrounded job
 * both left it on the shell's pid (a background job is by definition not the
 * foreground job).
 *
 * Why it matters: the terminal cap counts *live* shells. "Live" has to mean
 * "has work in flight", otherwise a panel that was opened, restarted, or
 * switched a few times pins the budget with shells that are all idle at a
 * prompt, and the next attach is rejected with nothing actually running.
 *
 * The value comes from the platform's `ProcessProbe` — `libproc` on macOS,
 * `/proc` on Linux — which is a synchronous read of a field the kernel already
 * has, and one `ps` subprocess answered it before. Measured on 8 live shells:
 * 30 ms for the spawn against 0.07 ms for the probe. `ps` stays as the fallback
 * for the platforms with no probe (the BSDs) and for the case where a probe
 * declines to answer, so the answer never depends on the fast path working.
 *
 * WINDOWS ANSWERS "NOT BUSY" FOR EVERY SHELL, and that is deliberate rather
 * than a gap: a ConPTY has no `tpgid`, no `ps`, and no `/proc`, so the question
 * is not answerable there without walking the process table through `ntdll`.
 * This function therefore reports what it KNOWS (nothing), which keeps the
 * panel's `busy` badge honest — an idle-looking shell is not claimed to be
 * running work. The CAP is a different question and does not use this answer
 * on Windows: `countLiveTerminals` bounds the budget by every live shell
 * instead, because a bound that never triggers is not a bound. See
 * `liveness.server.ts`.
 *
 * Advisory either way: any failure resolves to "not busy", because refusing a
 * shell to save a slot is worse than letting one extra through.
 */

import { processProbe } from '@/server/lib/lifecycle/proc';
import { childEnv } from '@/server/lib/fs/child-env';

const PS_TIMEOUT_MS = 1500;

/** Overridable so the Windows branch is reachable from a POSIX test. */
export interface BusyShellOptions {
  platform?: NodeJS.Platform;
}

/** `pid` is the shell's process (it is the PTY session leader, so pgid === pid). */
export interface ShellProcess {
  id: string;
  pid: number;
}

/**
 * The same question through `ps`, for a platform whose probe declined.
 *
 * Kept whole rather than merged into the probe path: it is the only mechanism
 * that works everywhere a `ps` is installed, and its subprocess machinery
 * (timeout, kill, reaping) is what the probe exists to avoid paying for.
 */
async function busyShellsViaPs(shells: ShellProcess[]): Promise<Set<string>> {
  const busy = new Set<string>();
  const byPid = new Map<number, string>();
  for (const shell of shells) byPid.set(shell.pid, shell.id);

  const ps = Bun.spawn(['ps', '-o', 'pid=,tpgid=', '-p', shells.map((s) => s.pid).join(',')], {
    stdout: 'pipe',
    stderr: 'ignore',
    env: childEnv(),
  });

  let output = '';
  try {
    output = await Promise.race([
      new Response(ps.stdout).text(),
      Bun.sleep(PS_TIMEOUT_MS).then(() => ''),
    ]);
  } catch {
    // The pipe died; fall through to the kill and the empty result.
  }
  try {
    ps.kill('SIGKILL');
  } catch {
    // Already exited.
  }
  void ps.exited.catch(() => {});

  for (const line of output.split('\n')) {
    const [pidText, tpgidText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const tpgid = Number(tpgidText);
    if (!Number.isFinite(pid) || !Number.isFinite(tpgid)) continue;
    const id = byPid.get(pid);
    // The shell holds the terminal exactly when it is its own foreground group.
    if (id !== undefined && tpgid !== pid) busy.add(id);
  }
  return busy;
}

export async function detectBusyShells(
  shells: ShellProcess[],
  options: BusyShellOptions = {},
): Promise<Set<string>> {
  const busy = new Set<string>();
  const platform = options.platform ?? process.platform;
  if (shells.length === 0 || platform === 'win32') return busy;

  // All-or-nothing: one shell the probe cannot answer for sends the whole set
  // through `ps`, which keeps a single answer for a single question instead of
  // mixing two sources whose failure modes differ.
  for (const shell of shells) {
    const tpgid = processProbe.foregroundGroup(shell.pid);
    if (tpgid === null) return busyShellsViaPs(shells);
    if (tpgid !== shell.pid) busy.add(shell.id);
  }
  return busy;
}
