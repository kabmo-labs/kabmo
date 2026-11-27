/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Git-ignore resolution for the Files panel.
 *
 * `git check-ignore` is the only authority that evaluates every rule source in
 * one pass — per-directory `.gitignore`, `.git/info/exclude`, and the global
 * `core.excludesFile` (`~/.gitignore`) — so the panel dims exactly what git
 * would refuse to track. Paths are fed NUL-separated over stdin (`--stdin -z`)
 * so a directory listing of any size cannot overflow argv, and the verbatim
 * NUL-separated reply maps straight back onto those same paths.
 *
 * Paths must be relative to `dir` and must exist on disk: git resolves
 * directory-only patterns (`build/`) by stat-ing the path.
 *
 * Repository DISCOVERY stops at `dir`'s parent (`GIT_CEILING_DIRECTORIES`), so
 * the rules that answer are the ones of a repository rooted at `dir` — never an
 * enclosing repository's. Without the ceiling git walks up from `dir` and a
 * workspace that is merely a subdirectory of some other repository answers with
 * that repository's rules: measured on `~/JatisMobile/Workspace/projects`
 * (a folder OF repositories, `.git` only in its children) whose parent repo
 * ignores `projects/` — every row, the nested repositories included, came back
 * `ignored: true` and the whole tree rendered faded. The ceiling is the parent
 * rather than `dir` itself because git treats a ceiling equal to the starting
 * directory as no ceiling at all (verified on git 2.56: `dir` still discovered
 * the repository above, `dirname(dir)` exited 128), while a repository rooted
 * AT `dir` is still found with the ceiling there — so a real workspace root
 * keeps its own `.gitignore`, `.git/info/exclude` and global excludes.
 *
 * Answers are memoized per path: the panel asks again every time a folder is
 * re-listed or re-expanded, and each question costs a `git` subprocess
 * (measured 5.6 ms). The TTL is short because a `.gitignore` the user just
 * edited should take effect without a reload; a path whose answer is still
 * cached is simply not asked about, so a re-listing of a known folder spawns
 * nothing at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { GIT_ENV } from '@kabmo-labs/kabmo-git/runner/git-run';

const CACHE_TTL_MS = 5_000;
/** Bound on remembered paths; the oldest answer is evicted past this. */
const CACHE_MAX_ENTRIES = 20_000;

interface IgnoreAnswer {
  ignored: boolean;
  at: number;
}

const cache = new Map<string, IgnoreAnswer>();

function cacheKey(dir: string, rel: string): string {
  return `${dir}\0${rel}`;
}

/**
 * Where git's repository discovery must stop: the parent of the browsed root.
 *
 * Resolved first, because git compares the ceiling against the real path of its
 * working directory — a workspace root reached through a symlink would other-
 * wise name a ceiling that is not an ancestor of `dir` and the walk would leak
 * the enclosing repository back in.
 */
function discoveryCeiling(dir: string): string {
  let real = dir;
  try {
    real = fs.realpathSync(dir);
  } catch {
    // Vanished between `readdir` and here: the unresolved path is still
    // absolute, and the listing is about to fail anyway.
  }
  return path.dirname(real);
}

export async function collectIgnoredPaths(dir: string, relPaths: string[]): Promise<Set<string>> {
  if (relPaths.length === 0) return new Set();

  const now = Date.now();
  const ignored = new Set<string>();
  const unknown: string[] = [];
  for (const rel of relPaths) {
    const answer = cache.get(cacheKey(dir, rel));
    if (answer && now - answer.at < CACHE_TTL_MS) {
      if (answer.ignored) ignored.add(rel);
      continue;
    }
    unknown.push(rel);
  }
  if (unknown.length === 0) return ignored;

  try {
    const proc = Bun.spawn({
      cmd: ['git', 'check-ignore', '--stdin', '-z'],
      cwd: dir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: 10_000,
      // The same three variables every other git spawn gets — `GIT_ENV` in
      // `lib/fs/git-run.ts` names what each prevents. This call site spawns
      // directly rather than through `runGit`/`runShell`, so it has to opt in.
      // The ceiling is this module's own rule: only the repository rooted at
      // the browsed root may answer (see the header).
      env: { ...Bun.env, ...GIT_ENV, GIT_CEILING_DIRECTORIES: discoveryCeiling(dir) },
    });

    // Drain stdout while the listing is written: a directory big enough to
    // fill both pipe buffers would otherwise deadlock child against parent.
    const stdout = new Response(proc.stdout).text();
    proc.stdin.write(unknown.map(rel => `${rel}\0`).join(''));
    // FileSink.end() types as `number | Promise<number>` — EPIPE (child gone)
    // must not surface as an unhandled rejection.
    void Promise.resolve(proc.stdin.end()).catch(() => {});

    const [text, exitCode] = await Promise.all([stdout, proc.exited]);
    // 0 = at least one path matched, 1 = none, 128 = no repository. Only 0 can
    // carry a match list, but every path still gets a definite answer: an
    // unlisted one is not ignored.
    const matched = exitCode === 0 ? new Set(text.split('\0').filter(Boolean)) : new Set<string>();

    // Only 0 and 1 mean git actually read the paths; 128 (no repository) is
    // not an answer, so nothing is cached from it and the next listing retries.
    const answered = exitCode === 0 || exitCode === 1;
    const stamped = Date.now();
    for (const rel of unknown) {
      const isIgnored = matched.has(rel);
      if (isIgnored) ignored.add(rel);
      if (answered) {
        if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
        cache.set(cacheKey(dir, rel), { ignored: isIgnored, at: stamped });
      }
    }

    return ignored;
  } catch {
    return ignored; // git missing / spawn failed — nothing is dimmed
  }
}
