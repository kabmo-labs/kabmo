/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The environment every `git` invocation Kabmo spawns must carry.
 *
 * Three variables, each one a bug that was measured rather than guessed:
 *
 * - `GIT_TERMINAL_PROMPT=0` — a command that decides it needs credentials must
 *   fail, not block the server waiting on a terminal that is not there.
 * - `GIT_EDITOR=true` — a rebase or merge that would open an editor gets the
 *   no-op instead, so it completes with the message git already has.
 * - `GIT_OPTIONAL_LOCKS=0` — a READ must not take `.git/index.lock`. `git
 *   status` is not read-only: with a stale index it refreshes and writes it
 *   back, so a merge issued while one was in flight failed with
 *   `Unable to create '.git/index.lock': File exists` — reproduced 8 of 8
 *   rounds with a concurrent `git status` on a stale index, 0 of 10 with this
 *   set.
 *
 * It lives in its own package so the modules that spawn git outside
 * `server/lib/fs/git-run` (the omp worktree resolver) get the same values
 * without importing the fs root, which owns the database.
 */
export const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_EDITOR: 'true',
  GIT_OPTIONAL_LOCKS: '0',
} as const;
