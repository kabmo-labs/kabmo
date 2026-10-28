/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Line blame for the editor, and the line's own history.
 *
 * ## One read for the WHOLE file, never one per hover
 *
 * `git blame -L n,n` costs a spawn (measured 10–20 ms warm, 39 ms average over
 * 20 sequential calls), and a reader hovers a dozen lines in a minute. The
 * whole-file read costs 30–110 ms ONCE and then answers every line from memory:
 * `--porcelain` reports each commit's metadata a single time (295 content lines
 * carried 5 `author` records on a 336-line file), so the payload is already
 * compressed — 34 KB raw for that file, 10 KB after the parse drops the
 * document text it does not need.
 *
 * The cost that has to be bounded is the OUTPUT, not the parse: `--porcelain`
 * on a 20 000-line file is 1.7 MB and `--line-porcelain` is 5.4 MB, while
 * `runGit` defaults to a 1 MiB `maxBuffer` — which would TRUNCATE the answer
 * silently and leave the bottom of the file with no attribution at all.
 *
 * ## The cache key is the answer
 *
 * A blame is only true for one (file contents, HEAD) pair. The key carries the
 * file's mtime — Kabmo's autosave rewrites it, which shifts every line number —
 * and the resolved HEAD sha, because a commit made by the agent while the panel
 * is open changes every answer. Neither is optional: keying on the path alone
 * serves the previous commit's authors for the current file.
 */

import {
  parseBlameHistory,
  parseBlamePorcelain,
  type BlameHistory,
  type BlamePayload,
  type BlameUnavailable,
} from '@/shared/lib/fs/git-blame';
import { repoRelative, resolveRepoPath, runGit } from '@/server/lib/fs/git-run';

/** Past this a blame is refused: 20 000 lines already costs 0.5 s and 1.7 MB. */
const MAX_BLAME_BYTES = 8 * 1024 * 1024;
/** `--porcelain` measured 1.7 MB at 20 000 lines; 16 MiB is headroom, not a guess. */
const MAX_BLAME_OUTPUT = 16 * 1024 * 1024;
const BLAME_TIMEOUT_MS = 15_000;
const HISTORY_TIMEOUT_MS = 15_000;
/** A line touched by more commits than this is a line nobody reads to the end. */
const HISTORY_LIMIT = 50;
/** Files kept in memory. One entry is the parse of a whole file. */
const CACHE_LIMIT = 64;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoGitBlame: Map<string, BlamePayload> | undefined;
}

function store(): Map<string, BlamePayload> {
  return (globalThis.__kabmoGitBlame ??= new Map());
}

function cached(key: string): BlamePayload | undefined {
  const map = store();
  const hit = map.get(key);
  if (!hit) return undefined;
  // Re-insert so the LRU drop takes the entry nobody has asked for in longest.
  map.delete(key);
  map.set(key, hit);
  return hit;
}

function remember(key: string, payload: BlamePayload): void {
  const map = store();
  map.set(key, payload);
  while (map.size > CACHE_LIMIT) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

/** Drop every cached answer. The test seam, and what a reload engine calls. */
export function resetBlameCache(): void {
  store().clear();
}

function unavailable(reason: BlameUnavailable, message?: string): BlamePayload {
  return { available: false, head: null, lines: 0, runs: [], commits: {}, reason, message };
}

/**
 * Blame every line of `file` against HEAD.
 *
 * `file` is repo-relative, exactly as the diff panel names it; a path that
 * resolves outside `targetDir` is refused before git sees it.
 */
export async function readBlame(targetDir: string, file: string): Promise<BlamePayload> {
  const rel = repoRelative(file);
  const absolute = resolveRepoPath(targetDir, rel);
  if (!absolute) return unavailable('error', 'Invalid path');

  let stat: { size: number; mtime: Date };
  try {
    stat = await Bun.file(absolute).stat();
  } catch {
    // A tab whose file was deleted: the answer is "there is nothing to blame",
    // not a failure — the editor already shows the deleted-file strip.
    return unavailable('untracked', 'This file is not on disk.');
  }
  if (stat.size > MAX_BLAME_BYTES) {
    return unavailable('too-large', `This file is ${(stat.size / (1024 * 1024)).toFixed(1)} MiB — too large to blame.`);
  }

  // One spawn answers both questions. A repository with no commit and a
  // directory that is not a repository fail differently, and git says which.
  const headResult = await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: targetDir, timeout: 5000 });
  if (headResult.exitCode !== 0 || headResult.error) {
    const stderr = headResult.stderr.trim();
    return unavailable(/not a git repository/i.test(stderr) ? 'not-repo' : 'no-commit', stderr);
  }
  const head = headResult.stdout.trim();

  const key = `${absolute}\u0000${stat.mtime.getTime()}\u0000${head}`;
  const hit = cached(key);
  if (hit) return hit;

  const result = await runGit(['blame', '--porcelain', '--', rel], {
    cwd: targetDir,
    timeout: BLAME_TIMEOUT_MS,
    maxBuffer: MAX_BLAME_OUTPUT,
  });
  if (result.exitCode !== 0 || result.error) {
    const stderr = result.stderr.trim();
    if (/not a git repository/i.test(stderr)) return unavailable('not-repo', stderr);
    // An untracked file, a path git cannot resolve, and a repository with an
    // unborn HEAD all land here with git's own sentence.
    if (/no such path|no such file|no such ref|did not match any file/i.test(stderr)) {
      return unavailable('untracked', stderr);
    }
    return unavailable('error', stderr || result.error?.message || 'git blame failed');
  }

  const { commits, runs } = parseBlamePorcelain(result.stdout);
  if (runs.length === 0) {
    const payload = unavailable('empty', 'git reported no lines for this file.');
    remember(key, payload);
    return payload;
  }

  const payload: BlamePayload = {
    available: true,
    head,
    // Blame covers the whole file, so the last run's end is the line count.
    lines: runs[runs.length - 1].to,
    runs,
    commits,
  };
  remember(key, payload);
  return payload;
}

/**
 * Every commit that touched `line`, newest first — the "who created it" answer.
 *
 * `git log -L n,n:<file>` follows the line as the file changed, which is why it
 * costs more than a blame (22–78 ms measured, against 10–20 for one blamed
 * line) and why it is a SECOND read the panel asks for only when the reader
 * opens the history: the blame already answers "who touched it last".
 *
 * `-s` suppresses the per-commit patch. Without it the output carries the diff
 * of every step, which the panel never draws.
 */
export async function readBlameHistory(targetDir: string, file: string, line: number): Promise<BlameHistory> {
  if (!Number.isInteger(line) || line < 1) return { entries: [], truncated: false };
  const rel = repoRelative(file);
  if (!resolveRepoPath(targetDir, rel)) return { entries: [], truncated: false };

  const result = await runGit(
    ['log', '-L', `${line},${line}:${rel}`, '-s', '--format=%H%x1f%an%x1f%at%x1f%s%x1e'],
    { cwd: targetDir, timeout: HISTORY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
  );
  // A line past the end of the file, a file that is not in HEAD, and a
  // repository with no commits all exit non-zero. Each means "no history for
  // this line", which the panel words; none of them is a failure to report.
  if (result.exitCode !== 0 || result.error) return { entries: [], truncated: false };

  const entries = parseBlameHistory(result.stdout);
  return { entries: entries.slice(0, HISTORY_LIMIT), truncated: entries.length > HISTORY_LIMIT };
}
