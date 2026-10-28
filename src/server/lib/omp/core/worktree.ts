/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read-only port of omp-web/lib/worktree.ts — resolves a session's cwd to the
 * main repository root so sessions from git worktrees group under one project.
 *
 * A linked worktree's `git rev-parse --git-common-dir` points at the *main*
 * repo's .git directory, so its parent is the project root shared by all
 * worktrees. Non-git directories resolve to themselves. Results are cached on
 * globalThis with a short TTL (this layer never mutates repos, so no eager
 * invalidation is needed).
 */

import { promises as fsp } from 'fs';
import { dirname, join } from 'path';
import { pathExists } from '@/server/lib/omp/core/paths';
import { GIT_ENV } from '@/server/lib/fs/git-run';

declare global {
  var __kabmoProjectCache: Map<string, { root: string; expiresAt: number }> | undefined;
}

const PROJECT_CACHE_TTL_MS = 60_000;

async function realPathOrSelf(filePath: string): Promise<string> {
  try {
    return await fsp.realpath(filePath);
  } catch {
    return filePath;
  }
}

function getProjectCache(): Map<string, { root: string; expiresAt: number }> {
  if (!globalThis.__kabmoProjectCache) globalThis.__kabmoProjectCache = new Map();
  return globalThis.__kabmoProjectCache;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn({
    cmd: ['git', '-C', cwd, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: { ...Bun.env, LC_ALL: 'C', ...GIT_ENV },
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed with exit code ${exitCode}`);
  return stdout.trim();
}

function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return normalizeForComparison(a) === normalizeForComparison(b);
}

/** Case-insensitive comparison on win32, case-sensitive elsewhere. */
function normalizeForComparison(value: string): string {
  if (!value) return value;
  const normalized = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Resolve a cwd to its repository root. Returns the cwd itself when it is not
 * inside a git repository (or the directory does not exist). Cached per-cwd
 * with a short TTL.
 */
export async function resolveProjectRoot(cwd: string): Promise<string> {
  const cache = getProjectCache();
  const cached = cache.get(cwd);
  if (cached && cached.expiresAt > Date.now()) return cached.root;

  let root: string;
  try {
    const dotGit = join(cwd, '.git');
    if (!(await pathExists(cwd)) || !(await pathExists(dotGit))) {
      root = await realPathOrSelf(cwd);
    } else {
      const out = await git(cwd, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
        '--show-toplevel',
      ]);
      const [commonDirRaw, toplevelRaw] = out.split('\n').map((l) => l.trim());
      const commonDir = await realPathOrSelf(commonDirRaw || '');
      const toplevel = await realPathOrSelf(toplevelRaw || '');
      const realCwd = await realPathOrSelf(cwd);
      const isTopLevel = samePath(toplevel, realCwd);
      // For a linked worktree, --git-common-dir differs from the toplevel's
      // .git: its parent is the MAIN repo root shared by all worktrees.
      const isWorktreeTopLevel = isTopLevel && !samePath(dirname(commonDir), dirname(toplevel));
      root = isWorktreeTopLevel ? await realPathOrSelf(dirname(commonDir)) : toplevel || realCwd;
    }
  } catch {
    root = await realPathOrSelf(cwd);
  }

  cache.set(cwd, { root, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  return root;
}
