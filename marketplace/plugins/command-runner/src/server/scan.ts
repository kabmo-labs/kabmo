/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The walk: which command files a scope has, and what each one declares.
 *
 * ## The filter is by hand, and that is the whole cost of this feature
 *
 * Bun.Glob's `ignore` option does NOT exclude node_modules — measured on 1.4.2,
 * `scanSync({ ignore: ['**\/node_modules\/**'] })` returns the same paths as no
 * `ignore` at all, and `dist/` is not excluded either. So a glob that silently
 * walked a 200 MB node_modules is exactly the failure this avoids, and the
 * excluded set is a table rather than a single test.
 *
 * ## Bounded, and the bound is REPORTED
 *
 * Depth 4 and 200 files, because a scan that walked an arbitrarily deep tree
 * would take unbounded time on the request thread. Hitting either cap sets
 * `truncated`, which the panel prints — a silently short list reads as "this
 * repository has three commands", which is a wrong answer rather than a partial
 * one.
 *
 * ## Containment is this module's guarantee
 *
 * The Kabmo's own root allow-list (the app root, a path under it, or a
 * registered `project_path`) is NOT re-implemented: it needs Kabmo's
 * database, and a plugin's server bundle cannot import Kabmo source. What this
 * does enforce is that `repo` resolves INSIDE `root` — which is the check that
 * stops `repo: '../../etc'`.
 */

import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';

import { DETECTORS, claimedFilenames, detectorFor } from './detectors/table';
import type { DetectorContext } from './detectors/types';
import { LOCKFILES, runnerForPackageManager, type Runner } from './package-manager';
import type { Command, CommandGroup, CommandKind, CommandListing } from '../protocol';

/** Directory names never descended into, whatever a repository keeps there. */
const SKIP_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  'target',
  'vendor',
];

const MAX_DEPTH = 4;
const MAX_FILES = 200;

/** The scope a scan runs in: a workspace root plus a repo path under it. */
export interface Scope {
  root: string;
  repo: string;
}

/**
 * The absolute directory a scope names, or null when it cannot be used.
 *
 * Null for four different faults — a relative root, a root that is not a
 * directory, a `repo` that escapes the root, a path that does not exist — because
 * the caller's only honest action is the same for all four: refuse and say the
 * repository is not readable.
 */
export function resolveScope(scope: Scope): string | null {
  // An ABSOLUTE root: a relative one would resolve against the server's own cwd,
  // which is how a request for `''` silently scans Kabmo's directory.
  if (!scope.root || !isAbsolute(scope.root)) return null;
  const base = resolve(scope.root);
  const target = resolve(base, scope.repo || '.');
  // Containment. The separator matters: `/ws-evil` must not pass as inside `/ws`.
  if (target !== base && !target.startsWith(base + sep)) return null;
  try {
    if (!statSync(target).isDirectory()) return null;
  } catch {
    return null;
  }
  return target;
}

/**
 * The kind order, as a sort key — the order the table declares.
 *
 * Derived from `DETECTORS` rather than restated, so a new source is ranked by
 * where its row sits instead of by an `if` somebody has to remember to extend.
 * A kind with no row (only `custom`, which no file produces) sorts last.
 */
function kindRank(kind: CommandKind): number {
  const index = KIND_ORDER.indexOf(kind);
  return index === -1 ? KIND_ORDER.length : index;
}

/** The kind order, taken from the table's own order. */
const KIND_ORDER: readonly CommandKind[] = DETECTORS.map((detector) => detector.kind);

/** The command id: what `start` takes, so the client never sends a command line. */
function withId(command: Command, file: string, kind: CommandKind): Command {
  return { ...command, id: `${file}#${kind}:${command.name}` };
}

/**
 * The package runner for one `package.json`.
 *
 * The file's own `packageManager` field wins, then the nearest lockfile walking
 * UP to the scope root, then Bun. (1) before (2) because a declared field is a
 * deliberate choice while a lockfile is a side effect; Bun last because that is
 * this app's own toolchain.
 */
export function resolveRunner(scopeRoot: string, file: string, text: string): Runner {
  try {
    const parsed = JSON.parse(text) as { packageManager?: unknown };
    const declared = runnerForPackageManager(parsed.packageManager);
    if (declared) return declared;
  } catch {
    // An unparseable file is the parse step's problem, not this one's.
  }

  const stop = resolve(scopeRoot);
  let current = dirname(file);
  for (;;) {
    for (const [lockfile, runner] of LOCKFILES) {
      if (existsSync(join(current, lockfile))) return runner;
    }
    const parent = dirname(current);
    if (parent === current || current === stop) break;
    current = parent;
  }
  return 'bun';
}

/** One file the walk found, with its text. */
interface FoundFile {
  path: string;
  kind: CommandKind;
  text: string;
  /** The file's path relative to the scanned root, `/`-separated. */
  repoPath: string;
  /** The reason the file could not be read, when it could not. */
  readError?: string;
}

/**
 * Directory listings, memoized for one scan.
 *
 * A detector that reads a directory (`go.mod`'s `cmd/`, the Gradle wrapper) asks
 * once per file, and a repository can hold several of them — so the same `cmd/`
 * must not be read twice in one walk. The cache is per scan rather than module
 * level: a scan is a snapshot, and a listing that outlived it would answer for a
 * tree that has since changed.
 */
function listingCache(): { entries(dir: string): string[]; dirs(dir: string): string[] } {
  const cache = new Map<string, { all: string[]; dirs: string[] }>();
  const read = (dir: string) => {
    const hit = cache.get(dir);
    if (hit) return hit;
    let all: string[] = [];
    const dirs: string[] = [];
    try {
      for (const entry of readdirSync(dir)) {
        all.push(entry);
        try {
          if (statSync(join(dir, entry)).isDirectory()) dirs.push(entry);
        } catch {
          // An entry that cannot be stat'd is neither, so it stays out of `dirs`.
        }
      }
    } catch {
      all = [];
    }
    const value = { all, dirs };
    cache.set(dir, value);
    return value;
  };
  return {
    entries: (dir) => read(dir).all,
    dirs: (dir) => read(dir).dirs,
  };
}

/** Collect the command files under `dir`, bounded and filtered by hand. */
function collectFiles(dir: string): { files: FoundFile[]; truncated: boolean } {
  const files: FoundFile[] = [];
  let truncated = false;

  const walk = (current: string, depth: number): void => {
    if (depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const full = join(current, entry);
      let isDir: boolean;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        // The hand filter: the glob's own `ignore` does nothing here.
        if (SKIP_DIRS.includes(entry)) continue;
        walk(full, depth + 1);
        continue;
      }
      const repoPath = relative(dir, full).split(sep).join('/');
      const detector = detectorFor(entry, repoPath);
      if (!detector) continue;
      try {
        files.push({ path: full, kind: detector.kind, text: readFileSync(full, 'utf8'), repoPath });
      } catch (error) {
        // Listed WITH the reason rather than skipped: a group that vanished
        // would read as a repository that does not have that file.
        files.push({
          path: full,
          kind: detector.kind,
          text: '',
          repoPath,
          readError: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  walk(dir, 0);
  return { files, truncated };
}

/** One collected file, as a group. */
function groupFor(
  dir: string,
  entry: FoundFile,
  listings: { entries(dir: string): string[]; dirs(dir: string): string[] },
): CommandGroup {
  const detector = detectorFor(basename(entry.path), entry.repoPath);
  const file = entry.repoPath;
  const cwd = relative(dir, dirname(entry.path)).split(sep).join('/') || '.';

  if (entry.readError) return { file, cwd, kind: entry.kind, commands: [], error: entry.readError };
  if (!detector) return { file, cwd, kind: entry.kind, commands: [], error: 'Unsupported command file.' };

  try {
    // The runner is resolved only for a source that declares it needs one — a
    // lockfile walk is filesystem work, and a `Makefile` has no use for its
    // answer.
    const runner = detector.needsRunner ? resolveRunner(dir, entry.path, entry.text) : undefined;
    const ctx: DetectorContext = {
      file: entry.path,
      dir: dirname(entry.path),
      entries: listings.entries,
      dirs: listings.dirs,
      ...(runner ? { runner } : {}),
    };
    const commands = detector.parse(entry.text, ctx).map((command) => withId(command, file, detector.kind));
    return { file, cwd, kind: detector.kind, commands, ...(runner ? { runner } : {}) };
  } catch (error) {
    return {
      file,
      cwd,
      kind: detector.kind,
      commands: [],
      error: `Could not read ${basename(entry.path)}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Walk a scope and list its command groups.
 *
 * Groups are ordered by the detector table's kind and then by path, so two scans
 * of one tree render the same list — a list that reorders between reads is a list
 * nobody can scan.
 */
export function scanScope(scope: Scope): CommandListing | { error: string } {
  const dir = resolveScope(scope);
  if (!dir) return { error: 'That repository is not readable from this workspace.' };

  const { files, truncated } = collectFiles(dir);
  const listings = listingCache();
  const groups = files
    .map((entry) => groupFor(dir, entry, listings))
    .sort((a, b) => (a.kind === b.kind ? a.file.localeCompare(b.file) : kindRank(a.kind) - kindRank(b.kind)));

  return { groups, truncated, sources: claimedFilenames() };
}
