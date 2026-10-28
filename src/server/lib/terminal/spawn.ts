/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The spawn options for a PTY shell, assembled in one place because ONE of them
 * is platform-bound and getting it wrong is silent in the worst way: the shell
 * starts, dies, and the panel looks broken with nothing in the log.
 *
 * POSIX needs `detached: true`. `setsid()` makes the shell its own process-group
 * leader, which is what lets `process.kill(-pid, …)` reach a foreground command
 * and what keeps a group signal from taking Kabmo down with the shell. The
 * controlling terminal it costs is restored by the `shellLaunch` shim.
 *
 * Windows must NOT detach. `detached` maps to `UV_PROCESS_DETACHED`, which passes
 * `DETACHED_PROCESS` to `CreateProcessW` — a child with **no console at all**.
 * `cmd.exe` will not run without one, so every shell exited with code 1 within a
 * second (measured on the Windows CI runner: all eight attached shells came back
 * `status: "exited"`, `exitCode: 1`), which left the cap counting nothing and
 * the panel showing a dead terminal. Windows has no process group to address
 * anyway — `killProcessTree` walks the tree with `taskkill /t`.
 *
 * It is a builder rather than a literal at the spawn site because the whole
 * point is a value a POSIX-only test run cannot observe: the assertions have to
 * ask for the Windows options explicitly.
 */

export interface ShellSpawnInput {
  /** The PTY the child's stdio is wired to. */
  terminal: Bun.Terminal;
  /** Working directory the shell opens in. */
  cwd: string;
  /** Environment for the child (already stripped of Kabmo's own). */
  env: Record<string, string | undefined>;
  /** Platform override, so the Windows branch is reachable from a POSIX run. */
  platform?: NodeJS.Platform;
}

/** Options for `Bun.spawn` when the child is an interactive shell on a PTY. */
export function shellSpawnOptions({ terminal, cwd, env, platform = process.platform }: ShellSpawnInput): {
  terminal: Bun.Terminal;
  detached: boolean;
  cwd: string;
  env: Record<string, string | undefined>;
} {
  // Windows deliberately false: `DETACHED_PROCESS` gives the child no console,
  // and a shell cannot run without one. Every other platform needs the session
  // so a group signal reaches what the shell started.
  return { terminal, detached: platform !== 'win32', cwd, env };
}
