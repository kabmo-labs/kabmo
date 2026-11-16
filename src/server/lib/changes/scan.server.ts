/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The filesystem reconciliation pass: what an opaque command changed.
 *
 * A `git reset --hard`, a `bun install`, a shell script — the classifier cannot
 * name their targets from `argv`, so the journal takes a cheap snapshot before
 * and after and journals the delta. The snapshot is `git status --porcelain`
 * plus the content of the dirty paths (bounded), because a path that was
 * already dirty has no HEAD version to fall back on.
 *
 * A path that was CLEAN at start has an exact before side: `git show HEAD:path`.
 * A path that was dirty at start is read at snapshot time, so a command that
 * rewrites it is still caught. A path outside the repo, or a repo that is not
 * there, answers `null` and the caller writes a note instead of a guess.
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { childEnv } from '@/server/lib/fs/child-env';

const SCAN_BUDGET_FILES = 200;
const GIT_TIMEOUT_MS = 5_000;
const DIR_SCAN_MAX_BYTES = 10 * 1024 * 1024;

export interface GitScan {
  root: string;
  /** Absolute path → content at snapshot time, for paths that were dirty. */
  dirty: Map<string, string | null>;
  /** The budget cut the dirty set; the caller says so rather than pretending. */
  truncated: boolean;
}

async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', '-C', cwd, ...args], {
      env: childEnv(),
      stdout: 'pipe',
      stderr: 'ignore',
      signal: AbortSignal.timeout(GIT_TIMEOUT_MS),
    });
    const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return code === 0 ? text : null;
  } catch {
    return null;
  }
}

/** `XY <path>\0` entries; a rename's second entry (the old path) is skipped. */
function parseStatus(output: string): string[] {
  const paths: string[] = [];
  for (const entry of output.split('\0')) {
    if (entry.length < 4 || entry[2] !== ' ') continue;
    paths.push(entry.slice(3));
  }
  return paths;
}

async function readText(absolute: string): Promise<string | null> {
  try {
    return await Bun.file(absolute).text();
  } catch {
    return null;
  }
}

/** Snapshot the repo's dirty set and its content; `null` outside a repo. */
export async function takeGitScan(cwd: string): Promise<GitScan | null> {
  const root = (await runGit(cwd, ['rev-parse', '--show-toplevel']))?.trim();
  if (!root) return null;
  const status = await runGit(root, ['status', '--porcelain=v1', '-z']);
  if (status === null) return null;

  const entries = parseStatus(status);
  const dirty = new Map<string, string | null>();
  for (const relative of entries.slice(0, SCAN_BUDGET_FILES)) {
    const absolute = path.resolve(root, relative);
    dirty.set(absolute, await readText(absolute));
  }
  return { root, dirty, truncated: entries.length > SCAN_BUDGET_FILES };
}

/**
 * A non-git fallback: the cwd's own files and their content, bounded.
 *
 * A `python3 script.py` in a temp directory writes files no `argv` names, and
 * there is no git index to ask. The directory scan is the only reconciliation
 * available there; it is bounded to 200 files and 10 MB, and a binary file is
 * skipped rather than journaled as a text diff.
 */
export async function takeDirScan(cwd: string): Promise<GitScan | null> {
  let entries;
  try {
    entries = await readdir(cwd, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirty = new Map<string, string | null>();
  let bytes = 0;
  let truncated = false;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (dirty.size >= SCAN_BUDGET_FILES) {
      truncated = true;
      break;
    }
    const absolute = path.join(cwd, entry.name);
    const info = await stat(absolute).catch(() => null);
    if (!info) continue;
    if (bytes + info.size > DIR_SCAN_MAX_BYTES) {
      truncated = true;
      continue;
    }
    const text = await readText(absolute);
    if (text === null || text.includes('\0')) continue;
    bytes += info.size;
    dirty.set(absolute, text);
  }
  return { root: cwd, dirty, truncated };
}

/** Git first (exact for tracked files), then the directory scan. */
export async function takeScan(cwd: string): Promise<GitScan | null> {
  const git = await takeGitScan(cwd);
  if (git) return git;
  return takeDirScan(cwd);
}

/** The content at HEAD for a path that was clean; `null` when it did not exist. */
export async function readHeadContent(root: string, absolute: string): Promise<string | null> {
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return runGit(root, ['show', `HEAD:${relative.replaceAll('\\', '/')}`]);
}
