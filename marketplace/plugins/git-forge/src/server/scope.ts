/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The scope: which directory is read, and the remote it carries.
 *
 * A plugin's server half runs inside Kabmo's process, so a path the client sends
 * is a path this plugin reads with the server's own rights. Two checks follow,
 * and both are the same shape the command-runner applies for the same reason:
 *
 * - `root` must be ABSOLUTE, because a relative root would resolve against
 *   Kabmo's own cwd and read a repository nobody named;
 * - `repo` must resolve INSIDE `root`, which is the check that stops
 *   `repo: '../../etc'`.
 *
 * Kabmo's own root allow-list is deliberately NOT re-implemented here: it needs
 * Kabmo's database, and a plugin's server bundle cannot import Kabmo's source
 * (`@/…` does not resolve in it). What this module can guarantee is the
 * containment above, plus the one thing it actually needs — that the directory
 * has an `origin`.
 */

import { isAbsolute, resolve, sep } from 'path';

export interface Scope {
  root: string;
  repo: string;
}

/** The absolute directory a scope names, or null when it is not contained. */
export function resolveScope(scope: Scope): string | null {
  if (!scope.root || !isAbsolute(scope.root)) return null;
  const base = resolve(scope.root);
  const target = resolve(base, scope.repo || '.');
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

/** The `origin` URL a checkout reports, or null when it has none. */
export function readOrigin(dir: string): string | null {
  const result = Bun.spawnSync(['git', 'remote', 'get-url', 'origin'], {
    cwd: dir,
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: 5_000,
    // A repository with no remote is the ordinary answer here, and git reports
    // it as exit 2 with a message — not a failure worth surfacing.
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.exitCode !== 0) return null;
  const url = result.stdout ? result.stdout.toString().trim() : '';
  return url || null;
}

/** Whether `dir` is inside a git work tree at all. */
export function isGitRepository(dir: string): boolean {
  const result = Bun.spawnSync(['git', 'rev-parse', '--is-inside-work-tree'], {
    cwd: dir,
    stdout: 'ignore',
    stderr: 'ignore',
    timeout: 5_000,
  });
  return result.exitCode === 0;
}
