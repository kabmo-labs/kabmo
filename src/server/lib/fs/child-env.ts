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

/** Names that must never reach a child, whatever the parent's environ holds. */
const WITHHELD = [UI_PASSWORD_ENV] as const;

/**
 * A copy of the current environment with the credential removed, plus any
 * caller overrides applied ON TOP (so a caller that genuinely needs a variable
 * set for its child still can).
 */
export function childEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...Bun.env, ...overrides };
  for (const name of WITHHELD) delete env[name];
  return env;
}
