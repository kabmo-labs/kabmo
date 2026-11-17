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
import { isBuildPath, isExcludedTempPath } from '@/server/lib/changes/temp-path';

const SCAN_BUDGET_FILES = 200;
const GIT_TIMEOUT_MS = 5_000;
const DIR_SCAN_MAX_BYTES = 10 * 1024 * 1024;
const MAX_NESTED_REPOS = 20;
const MAX_WALK_DIRS = 200;

export interface GitScan {
  root: string;
  /** Absolute path → content at snapshot time, for paths that were dirty. */
  dirty: Map<string, string | null>;
  /** The budget cut the dirty set; the caller says so rather than pretending. */
  truncated: boolean;
  /** Path prefix → repo root, so a nested repo's `readHead` uses its own HEAD. */
  roots?: Map<string, string>;
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
  // `--no-optional-locks` is a GLOBAL git option, so it must precede the
  // subcommand: `git status --no-optional-locks` is an unknown option and made
  // every scan fall back to the directory walk.
  const status = await runGit(root, ['--no-optional-locks', 'status', '--porcelain=v1', '-z']);
  if (status === null) return null;

  const entries = parseStatus(status);
  const dirty = new Map<string, string | null>();
  for (const relative of entries.slice(0, SCAN_BUDGET_FILES)) {
    const absolute = path.resolve(root, relative);
    if (isExcludedTempPath(absolute, cwd) || isBuildPath(absolute, cwd)) continue;
    dirty.set(absolute, await readText(absolute));
  }
  return { root, dirty, truncated: entries.length > SCAN_BUDGET_FILES, roots: new Map([[root, root]]) };
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
  const files: string[] = [];
  let truncated = await walkFiles(cwd, files, SCAN_BUDGET_FILES, cwd);
  const dirty = new Map<string, string | null>();
  let bytes = 0;
  for (const absolute of files) {
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
  return { root: cwd, dirty, truncated, roots: new Map([[cwd, cwd]]) };
}

/** Recursive file walk, bounded; `node_modules` and `.git` are skipped. */
async function walkFiles(dir: string, out: string[], budget: number, cwd: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (out.length >= budget) return true;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(dir, entry.name);
    if (isExcludedTempPath(absolute, cwd) || isBuildPath(absolute, cwd)) continue;
    if (entry.isDirectory()) {
      if (await walkFiles(absolute, out, budget, cwd)) return true;
    } else if (entry.isFile()) {
      out.push(absolute);
    }
  }
  return false;
}

/**
 * Nested git repos under `cwd`.
 *
 * A workspace can be a parent repo whose projects are their own checkouts
 * (`Workspace/projects/<project>`). The parent's `git status` does not show a
 * nested repo's files, so a scan that only asks the parent misses every change
 * an opaque command made inside a project. The walk stops at the first `.git`
 * it finds and asks that repo directly; it is bounded so a large workspace
 * cannot turn one scan into a full-tree crawl.
 */
async function takeNestedGitScans(cwd: string): Promise<{ scans: GitScan[]; truncated: boolean }> {
  const scans: GitScan[] = [];
  let dirs = 0;
  let truncated = false;

  const walk = async (dir: string): Promise<void> => {
    if (scans.length >= MAX_NESTED_REPOS || dirs >= MAX_WALK_DIRS) {
      truncated = true;
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (scans.length >= MAX_NESTED_REPOS) {
        truncated = true;
        return;
      }
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const absolute = path.join(dir, entry.name);
      if (isExcludedTempPath(absolute, cwd) || isBuildPath(absolute, cwd)) continue;
      dirs++;
      if (dirs > MAX_WALK_DIRS) {
        truncated = true;
        return;
      }
      const gitEntry = await stat(path.join(absolute, '.git')).catch(() => null);
      if (gitEntry) {
        const scan = await takeGitScan(absolute);
        if (scan) scans.push(scan);
        continue;
      }
      await walk(absolute);
    }
  };

  await walk(cwd);
  return { scans, truncated };
}

/** Git first (the parent and its nested repos), then the directory scan. */
export async function takeScan(cwd: string): Promise<GitScan | null> {
  const parent = await takeGitScan(cwd);
  const nested = await takeNestedGitScans(cwd);
  if (!parent && nested.scans.length === 0) return takeDirScan(cwd);

  const dirty = new Map<string, string | null>();
  const roots = new Map<string, string>();
  if (parent) {
    for (const [absolute, content] of parent.dirty) dirty.set(absolute, content);
    for (const [prefix, root] of parent.roots ?? []) roots.set(prefix, root);
  }
  for (const scan of nested.scans) {
    for (const [absolute, content] of scan.dirty) dirty.set(absolute, content);
    for (const [prefix, root] of scan.roots ?? []) roots.set(prefix, root);
  }
  return {
    root: parent?.root ?? cwd,
    dirty,
    truncated: (parent?.truncated ?? false) || nested.truncated || nested.scans.some((scan) => scan.truncated),
    roots,
  };
}

/** The content at HEAD for a path that was clean; `null` when it did not exist. */
export async function readHeadContent(root: string, absolute: string): Promise<string | null> {
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return runGit(root, ['show', `HEAD:${relative.replaceAll('\\', '/')}`]);
}
