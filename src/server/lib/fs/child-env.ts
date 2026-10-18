/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The environment every child of this server gets.
 *
 * `Bun.spawn` with no `env` option inherits the OS environ, and `delete
 * Bun.env.X` does NOT remove a value that was there at startup — measured on
 * Bun 1.4.3. So a process that received `OMPCHAMBER_UI_PASSWORD` hands it to
 * every child it starts, including the ones that run third-party code: a
 * plugin's `bun install`, `git` hooks, `rg`, `omp` itself. Ten spawn sites in
 * this server passed no `env` at all, so each was a hole.
 *
 * This module is the one place that answers "what does a child get", so a new
 * spawn site cannot silently reintroduce the leak: call `childEnv()` (or spread
 * it) rather than reaching for `Bun.env`. An explicit env REPLACES the child's
 * environment rather than merging into it, which is what makes the removal real.
 */

import { UI_PASSWORD_ENV } from '@/shared/lib/auth/password';

/**
 * Names that must never reach a child, whatever the parent's environ holds,
 * keyed by their upper-case spelling (Windows env names are case-insensitive).
 */
const WITHHELD: Record<string, true> = { [UI_PASSWORD_ENV.toUpperCase()]: true };

/**
 * A copy of the current environment with the credential removed, plus any
 * caller overrides applied ON TOP (so a caller that genuinely needs a variable
 * set for its child still can).
 *
 * `platform` is a parameter rather than a read of `process` for the reason
 * `stripChamberHostEnv` takes one: Windows env names are case-insensitive, so
 * `Ompchamber_Ui_Password` IS the withheld variable there, and the only way to
 * exercise that branch on a POSIX runner is to hand it in. An exact-name delete
 * leaves a differently-cased spelling in the child's environment.
 */
export function childEnv(
  overrides: Record<string, string | undefined> = {},
  platform: string = process.platform,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...Bun.env, ...overrides };
  for (const name of Object.keys(env)) {
    if (WITHHELD[platform === 'win32' ? name.toUpperCase() : name] === true) delete env[name];
  }
  return env;
}
