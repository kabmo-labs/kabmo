/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which directory is read, and the remote it carries.
 *
 * A plugin's server half runs inside Kabmo's process, so a path the client sends
 * is a path this plugin reads with the server's own rights. Two checks follow:
 * `root` must be absolute (a relative root would resolve against Kabmo's cwd and
 * read a repository nobody named), and `repo` must resolve INSIDE `root` (the
 * check that stops `repo: '../../etc'`).
 *
 * Kabmo's own root allow-list is deliberately not re-implemented here: it needs
 * the host's database, which a plugin bundle cannot import. What this module
 * guarantees is containment, plus the one thing it needs — that the directory is
 * a checkout with an `origin`.
 */

import { isAbsolute, resolve, sep } from 'node:path';

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
    // it as exit 2 — not a failure worth surfacing as one.
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.exitCode !== 0) return null;
  const url = result.stdout ? result.stdout.toString().trim() : '';
  return url || null;
}
