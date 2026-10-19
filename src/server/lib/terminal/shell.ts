/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which shell the PTY runtime launches, with which argv, and with which
 * environment.
 *
 * Resolution is a pure function of the environment plus an existence probe, so
 * the preference order stays testable without spawning anything: the user's
 * `$SHELL` first, then the platform's usual suspects.
 */

import { stripChamberHostEnv } from '@kabmo-labs/plugin-sdk';

const POSIX_FALLBACKS = ['/bin/zsh', '/bin/bash', '/bin/sh'];

/** Candidate executables, most preferred first. */
export function shellCandidates(
  env: Record<string, string | undefined> = Bun.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === 'win32') {
    const comspec = env.COMSPEC?.trim();
    return comspec ? [comspec] : ['cmd.exe'];
  }
  const candidates: string[] = [];
  const preferred = env.SHELL?.trim();
  // Only an absolute $SHELL is trusted: a bare name would be resolved against
  // PATH at spawn time, which is not the login shell the user configured.
  if (preferred && preferred.startsWith('/')) candidates.push(preferred);
  for (const fallback of POSIX_FALLBACKS) {
    if (!candidates.includes(fallback)) candidates.push(fallback);
  }
  return candidates;
}

/**
 * `-i -l` for POSIX shells: interactive (prompt, line editing, job control —
 * job control is what makes Ctrl+Z/`fg` work at all) and login (the user's
 * profile, so PATH and aliases match a normal terminal). cmd.exe takes neither.
 */
export function shellArgs(platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? [] : ['-i', '-l'];
}

/**
 * Full argv for the PTY child.
 *
 * POSIX shells are launched through a one-line `/bin/sh` shim that re-acquires
 * the PTY as its controlling terminal before `exec`-ing the real shell:
 *
 *     if [ -t 0 ]; then exec <shell> -i -l </dev/fd/0 >/dev/fd/0 2>&1; fi; exec <shell> -i -l
 *
 * This is required, not cosmetic. The runtime must spawn with
 * `detached: true` — without it the child lands in the *server's* process
 * group, where a group signal would take the chamber down and `SIGWINCH`
 * cannot be addressed to the shell alone. But `setsid()` also drops the
 * controlling terminal, and a shell with no controlling tty silently disables
 * job control (`setopt monitor` fails): Ctrl+Z, `fg` and `jobs` stop working,
 * and typing while a foreground command runs goes to that command instead of
 * the shell. Re-opening the terminal as stdin/stdout restores it. Verified on
 * both macOS and Linux: with the shim `tpgid` is the shell's own pid and
 * `setopt monitor` succeeds; without it `tpgid` is -1 and Ctrl+Z is swallowed.
 *
 * Two details are load-bearing, and each was a real failure:
 *
 * - **The device is `/dev/fd/0`, not `/dev/tty`.** `/dev/tty` resolves through
 *   the child's *controlling terminal*, and a `setsid()` child has none — so on
 *   Linux the open fails with `ENXIO` ("no such device or address") even though
 *   the node exists, while on macOS the same open succeeds because Darwin
 *   tolerates it. That platform split is what took CI down: every terminal test
 *   timed out because the shim died before the shell ever started. `/dev/fd/0`
 *   is the PTY the parent already wired up, so it needs no controlling terminal
 *   to resolve and is correct on both.
 * - **The guard is `[ -t 0 ]`**, which asks whether stdin is a terminal. The
 *   device nodes are no test at all — `/dev/tty` always exists and `/dev/fd/0`
 *   always exists — so a guard built on them takes the redirect branch on a
 *   child that has no terminal, and the failing redirect then kills the shim
 *   (dash exits 2, the shell never starts) with the fallback never reached.
 *
 * This replaces `T=$(tty 2>/dev/null); … <"$T" >"$T"`, which paid a whole
 * `/usr/bin/tty` subprocess per terminal to learn a path the kernel already
 * resolves. Measured to spawn: 5.37 ms -> 3.32 ms on macOS.
 *
 * `exec` keeps the pid, so the shell stays the session leader and group kill
 * still reaches everything it starts. If stdin is not a terminal the shell runs
 * unredirected — stdio is already wired to whatever the parent gave it, only
 * job control is lost.
 */
export function shellLaunch(executable: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return [executable];
  const inner = [executable, ...shellArgs(platform)].join(' ');
  return [
    '/bin/sh',
    '-c',
    `if [ -t 0 ]; then exec ${inner} </dev/fd/0 >/dev/fd/0 2>&1; fi; exec ${inner}`,
  ];
}

/**
 * Environment for the PTY child. `TERM`/`COLORTERM` describe the renderer on
 * the other end of the socket; `COLORFGBG` carries the active chamber theme so
 * prompts that read it (zsh themes, vim) pick readable colors.
 *
 * The chamber's OWN variables are removed by the shared SDK rule, for the same
 * reason `NODE_CHANNEL_FD` and the password are: this shell must behave like the
 * one on the operator's desktop, and `PORT` here is the port the CHAMBER is
 * serving (the CLI sets it on the server process) — measured, a PTY under a
 * chamber on 3001 reported `PORT=3001 NODE_ENV=production`, so a `bun run dev`
 * typed into this panel hit "Port 3001 is already served by Kabmo" while
 * the same command in a plain terminal ran on 3000. `NODE_ENV` matters beyond
 * the port: it decides dev vs production for whatever the user runs, and
 * `production` makes `bun install`/`npm install` skip devDependencies.
 */
export function terminalEnv(
  base: Record<string, string | undefined>,
  theme: 'light' | 'dark' = 'dark',
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = stripChamberHostEnv(base, process.platform);
  // The chamber's own IPC descriptor is host-private and meaningless inside the
  // PTY; an inherited value makes Node CLIs fail to parse their IPC channel.
  delete env.NODE_CHANNEL_FD;
  // Belt and braces. `lib/auth/env-password.ts` already removes this at boot, so
  // the value should never reach here — but the shell panel is the one place a
  // leaked password is trivially readable (`echo $OMPCHAMBER_UI_PASSWORD`), and
  // a future refactor of the boot path must not be able to reintroduce that.
  delete env.OMPCHAMBER_UI_PASSWORD;
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.COLORFGBG = theme === 'light' ? '0;15' : '15;0';
  return env;
}

/** First candidate that exists on disk, or null when none does. */
export async function resolveShellExecutable(
  candidates: string[],
  exists: (target: string) => Promise<boolean> = async (target) => Bun.file(target).exists(),
): Promise<string | null> {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}
