/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Saving and restoring an environment variable across a suite.
 *
 * `Bun.env.X = saved` looks like a faithful restore and is not: when `saved` is
 * `undefined` — a variable the runner never had — Bun stores the STRING
 * `"undefined"`. Measured on Bun 1.4.4:
 *
 * ```
 * const saved = Bun.env.__PROBE;   // undefined
 * Bun.env.__PROBE = saved;
 * Bun.env.__PROBE;                 // "undefined"  (typeof "string")
 * ```
 *
 * On a Windows runner `HOME` is not set (the variable there is `USERPROFILE`),
 * so every suite that redirected `$HOME` and restored it this way left `HOME`
 * holding `"undefined"` for the rest of the process. `homeDir()` prefers
 * `Bun.env.HOME`, so the roots it builds became RELATIVE — measured on the
 * Windows gate as `undefined\.claude\commands` and `undefined\.agents\skills`
 * in `discovery-roots.test.ts`, in a file that does nothing with `HOME` itself.
 *
 * `delete` is the only faithful restore for an absent variable.
 */

/** The value to hand back to `restoreEnv`, captured before a test changes it. */
export function saveEnv(name: string): string | undefined {
  return Bun.env[name];
}

/** Put `name` back to `value`; an absent variable is DELETED, never assigned. */
export function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete Bun.env[name];
  else Bun.env[name] = value;
}
