/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The password a server run was given, and the environment cleanup that goes
 * with it.
 *
 * Two sources, checked in order: the `--ui-password` argv flag (the CLI hashes
 * it before spawning, so the value normally arrives only when someone runs the
 * server by hand) and `KABMO_UI_PASSWORD`.
 *
 * The environment variable is DELETED the moment it is read, before any await.
 * `Bun.env` and `process.env` are the same object, and every child this server
 * spawns inherits it — the terminal panel's PTY (`lib/terminal/shell.ts`), the
 * omp RPC child (`lib/omp/rpc/process.ts`), `git`, `rg`. Without the delete, a
 * password supplied through the environment is readable from inside the
 * Kabmo's own terminal (`echo $KABMO_UI_PASSWORD`) and by any process the
 * agent runs — a worse exposure than the argv leak the flag avoids.
 *
 * There is no file fallback. A stored password would let a `bun run dev` demand
 * a credential the person running it never set, which is the behaviour this
 * module exists to remove.
 */

import { LEGACY_UI_PASSWORD_ENV, UI_PASSWORD_ENV } from '@/shared/lib/auth/password';

/** argv flag carrying a password directly to the server (bypassing the CLI). */
export const UI_PASSWORD_FLAG = '--ui-password';

export interface ResolvedRunPassword {
  /** The password for this run, or null when authentication is off. */
  password: string | null;
  /** Where it came from, for the boot banner. */
  source: 'argv' | 'env' | 'none';
}

/**
 * Read a password from argv, then the environment. The environment variable is
 * erased as a side effect — ALWAYS, including when argv wins.
 *
 * argv takes precedence so an explicit flag beats an inherited variable, the
 * same order the CLI applies. But the variable is consumed either way: leaving
 * it behind because a flag outranked it would still hand the password to every
 * child process, which is the leak this module exists to prevent.
 *
 * `--ui-password` is matched both as `--ui-password value` and
 * `--ui-password=value`.
 */
export function resolveRunPassword(argv: readonly string[] = Bun.argv): ResolvedRunPassword {
  // The pre-rename spelling is read as well, and BOTH are erased: an install
  // whose shell profile still exports `OMPCHAMBER_UI_PASSWORD` must keep its
  // protection, and leaving that one behind would hand the plaintext to every
  // child — the leak the erase exists to prevent.
  const fromEnv = Bun.env[UI_PASSWORD_ENV] ?? Bun.env[LEGACY_UI_PASSWORD_ENV];
  // Erased before any await, and before the caller hashes anything: a failure
  // must not leave the plaintext in the environment of a process that keeps
  // running.
  delete Bun.env[UI_PASSWORD_ENV];
  delete Bun.env[LEGACY_UI_PASSWORD_ENV];
  const envPassword = fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : null;

  const flagIndex = argv.indexOf(UI_PASSWORD_FLAG);
  if (flagIndex !== -1) {
    const next = argv[flagIndex + 1];
    if (typeof next === 'string' && next.length > 0 && !next.startsWith('-')) {
      return { password: next, source: 'argv' };
    }
  }
  for (const arg of argv) {
    if (arg.startsWith(`${UI_PASSWORD_FLAG}=`)) {
      const value = arg.slice(UI_PASSWORD_FLAG.length + 1);
      if (value.length > 0) return { password: value, source: 'argv' };
    }
  }

  return envPassword ? { password: envPassword, source: 'env' } : { password: null, source: 'none' };
}
