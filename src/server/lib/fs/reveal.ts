/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Open a directory in the platform's file manager — the "Go to Explorer"
 * action behind a workspace folder's menu.
 *
 * Two properties the previous implementation (a `sh -c` string with the path
 * interpolated into double quotes) did not have, and both are the point:
 *
 * 1. **argv, never a shell string.** A workspace path is user-chosen and may
 *    contain a quote, a `$`, or a backtick; interpolating it into a command
 *    line lets it close the quoting and run whatever follows. Passing it as an
 *    argv element means there is no shell to escape at all.
 *
 * 2. **A real verdict.** The old call was fire-and-forget — it returned
 *    `{success: true}` while the opener exited 1 with "does not exist" on
 *    stderr, so the menu looked like it worked and nothing opened. This waits
 *    for the opener and reports what it said.
 */

import path from 'path';
import { childEnv } from '@/server/lib/fs/child-env';

/** How long the opener gets before it is treated as hung. */
const REVEAL_TIMEOUT_MS = 5000;

export type RevealResult = { ok: true; opener: string } | { ok: false; error: string };

/**
 * The opener per platform, in preference order.
 *
 * `gio open` is the modern spelling on a Linux desktop that has no `xdg-open`;
 * it is a fallback rather than the first choice only because `xdg-open` is the
 * one every desktop ships.
 */
const OPENERS: Record<string, readonly string[]> = {
  darwin: ['open'],
  win32: ['explorer'],
  linux: ['xdg-open', 'gio'],
};

/** Platforms with no entry above fall back to the freedesktop opener. */
const FALLBACK_OPENERS = ['xdg-open'] as const;

export async function revealInFileManager(dir: string): Promise<RevealResult> {
  const target = path.resolve(dir);

  // Checked here rather than left to the opener: `open` on a missing path exits
  // 1 with a message, but on some platforms the opener succeeds against a path
  // it silently ignores, and a workspace whose directory was deleted is the
  // common case worth naming exactly.
  const stat = await Bun.file(target).stat().catch(() => null);
  if (!stat) return { ok: false, error: `Directory does not exist: ${target}` };
  if (!stat.isDirectory()) return { ok: false, error: `Not a directory: ${target}` };

  const candidates = OPENERS[process.platform] ?? FALLBACK_OPENERS;
  const opener = candidates.find((bin) => Bun.which(bin) !== null);
  if (!opener) {
    return { ok: false, error: `No file manager opener on PATH (tried ${candidates.join(', ')})` };
  }

  let proc: Bun.Subprocess<'ignore', 'ignore', 'pipe'>;
  try {
    proc = Bun.spawn({
      env: childEnv(),
      cmd: [opener, target],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
      // Its own process group, so a signal aimed at the server's group (a
      // restart, a supervisor's stop) cannot take the user's file manager down
      // with it.
      detached: true,
      timeout: REVEAL_TIMEOUT_MS,
    });
  } catch (error) {
    // Bun throws synchronously when the binary cannot be spawned at all.
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const stderr = (await new Response(proc.stderr).text()).trim();
  const exitCode = await proc.exited;

  // `explorer.exe` answers 1 whether or not the folder opened — its exit code
  // reports whether an existing window was reused, not whether the request
  // succeeded — so on Windows only a spawn failure is a failure. [INFERENCE:
  // the Windows quirk is documented behaviour, but it was NOT verified on this
  // machine; the macOS and Linux branches below are the ones exercised.]
  if (process.platform === 'win32' && !proc.killed) return { ok: true, opener };

  if (proc.killed && proc.signalCode === 'SIGTERM') {
    return { ok: false, error: `${opener} did not return within ${REVEAL_TIMEOUT_MS}ms` };
  }
  if (exitCode !== 0) {
    return { ok: false, error: stderr || `${opener} exited with code ${exitCode}` };
  }
  return { ok: true, opener };
}
