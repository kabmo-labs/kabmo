/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Line blame, as DATA: the payload, its parser, and the two lookups a reader
 * makes.
 *
 * The parser is here rather than in the server module because it is pure text
 * in and text out — which is what lets it be pinned by a test without spawning
 * git, and what would let a future client fold a payload it already has.
 *
 * ## `--porcelain` is one header per LINE, not one per group
 *
 * The header carries a group count (`<sha> <orig> <final> <count>`), and it is
 * tempting to expand it into a range. Measured on a 336-line file: git prints
 * `sha 1 1 40` and then `sha 2 2`, `sha 3 3` … — one header per line, with the
 * count on the FIRST only. Expanding by the count produced overlapping runs
 * (`1-40`, then `2-40`), so the runs are built from the line each header names
 * and merged when consecutive lines share a sha.
 *
 * ## Metadata appears once per COMMIT, not per line
 *
 * 295 content lines carried 5 `author` lines on that file. So a commit record
 * is filled wherever its metadata first appears, and a later header naming the
 * same sha adds nothing — which is why the parse keeps a map keyed by sha
 * instead of a record per line.
 */

/** One commit a blame run refers to. `time` is seconds since the epoch. */
export interface BlameCommit {
  sha: string;
  author: string;
  mail: string;
  time: number;
  summary: string;
}

/** A run of consecutive lines attributed to one commit. 1-based, inclusive. */
export interface BlameRun {
  from: number;
  to: number;
  sha: string;
}

/** Why a file has no blame, as a value rather than a sentence at each surface. */
export type BlameUnavailable =
  | 'not-repo'
  | 'no-commit'
  | 'untracked'
  | 'too-large'
  | 'empty'
  | 'error';

export interface BlamePayload {
  available: boolean;
  /** The commit the answer was computed against, so a reader can say which. */
  head: string | null;
  /**
   * How many lines the blamed document had.
   *
   * Carried rather than derived at the surface: a line the payload cannot place
   * is either a line that does not exist yet (the buffer is longer than the
   * file) or one the parse lost, and the panel has to say which. Blame covers
   * the whole file, so the last run's end IS the count.
   */
  lines: number;
  runs: BlameRun[];
  commits: Record<string, BlameCommit>;
  reason?: BlameUnavailable;
  message?: string;
}

/** One entry of `git log -L`, newest first. */
export interface BlameHistoryEntry {
  sha: string;
  author: string;
  time: number;
  summary: string;
}

export interface BlameHistory {
  entries: BlameHistoryEntry[];
  /** More commits touched this line than the server would send. */
  truncated: boolean;
}

/** The sha git reports for a line that is not in HEAD. */
const UNCOMMITTED_SHA = '0'.repeat(40);

const HEADER = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/;

/** `0000…` is git's own spelling of "this line is not committed". */
export function isUncommittedSha(sha: string): boolean {
  return sha === UNCOMMITTED_SHA;
}

/**
 * Parse `git blame --porcelain` output.
 *
 * Runs are sorted by their first line so `blameRunAt` can binary-search them —
 * git emits in file order, and sorting is the cheap way not to depend on it.
 */
export function parseBlamePorcelain(out: string): {
  commits: Record<string, BlameCommit>;
  runs: BlameRun[];
} {
  const commits: Record<string, BlameCommit> = {};
  const runs: BlameRun[] = [];
  let sha: string | null = null;
  let line = 0;

  const pushLine = (from: number, at: string) => {
    const last = runs[runs.length - 1];
    if (last && last.sha === at && last.to + 1 === from) last.to = from;
    else runs.push({ from, to: from, sha: at });
  };

  for (const raw of out.split('\n')) {
    if (raw.length === 0) continue;
    // The line's own text. It is the only thing that ends a header's record,
    // and it is deliberately discarded: the caller already holds the document.
    if (raw.charCodeAt(0) === 9) {
      if (sha !== null) pushLine(line, sha);
      sha = null;
      continue;
    }
    const header = HEADER.exec(raw);
    if (header) {
      sha = header[1];
      line = Number(header[2]);
      commits[sha] ??= { sha, author: '', mail: '', time: 0, summary: '' };
      continue;
    }
    if (sha === null) continue;
    const space = raw.indexOf(' ');
    if (space < 0) continue;
    const key = raw.slice(0, space);
    const value = raw.slice(space + 1);
    const commit = commits[sha];
    if (key === 'author') commit.author = value;
    else if (key === 'author-mail') commit.mail = value.replace(/^</, '').replace(/>$/, '');
    else if (key === 'author-time') commit.time = Number(value);
    else if (key === 'summary') commit.summary = value;
  }

  runs.sort((a, b) => a.from - b.from);
  return { commits, runs };
}

/** The run covering `line`, or null when the line is outside the file. */
export function blameRunAt(runs: readonly BlameRun[], line: number): BlameRun | null {
  let low = 0;
  let high = runs.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const run = runs[mid];
    if (line < run.from) high = mid - 1;
    else if (line > run.to) low = mid + 1;
    else return run;
  }
  return null;
}

/** The commit that last touched `line`, or null when the payload has none. */
export function blameAt(
  payload: BlamePayload,
  line: number,
): { run: BlameRun; commit: BlameCommit } | null {
  if (!payload.available) return null;
  const run = blameRunAt(payload.runs, line);
  if (!run) return null;
  const commit = payload.commits[run.sha];
  if (!commit) return null;
  return { run, commit };
}

/**
 * A short age, as a label can hold: `just now`, `7m ago`, `3d ago`, `2mo ago`.
 *
 * Compact rather than prose because it sits at the end of a code line, and
 * because the panel prints the same string — one formatter, so the label and
 * the panel cannot disagree about how old the commit is.
 */
export function formatBlameAge(epochSeconds: number, nowMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - epochSeconds);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** The sentence a surface prints for a file with no blame. */
export function blameUnavailableText(reason: BlameUnavailable, message?: string): string {
  switch (reason) {
    case 'not-repo':
      return 'This folder is not a git repository.';
    case 'no-commit':
      return 'This repository has no commits yet.';
    case 'untracked':
      return 'This file has never been committed, so it has no history.';
    case 'too-large':
      return message ?? 'This file is too large to blame.';
    case 'empty':
      return 'This file is empty.';
    default:
      return message ?? 'git could not read this file.';
  }
}

/** The one-line label a line wears: `Ada Lovelace · 4d ago`. */
export function blameLabel(commit: BlameCommit, nowMs: number = Date.now()): string {
  if (isUncommittedSha(commit.sha)) return 'Not committed yet';
  const author = commit.author.trim() || 'Unknown';
  return `${author} · ${formatBlameAge(commit.time, nowMs)}`;
}

/**
 * Parse `git log -L` output written with `\x1f` field separators and `\x1e`
 * record separators.
 *
 * A record separator is required: a commit subject is free to contain a
 * newline-free `\x1f`-free string but nothing stops it from containing the
 * characters a plain newline split would rely on, and git's own `%s` is
 * single-line only by convention, not by rule.
 */
export function parseBlameHistory(out: string): BlameHistoryEntry[] {
  const entries: BlameHistoryEntry[] = [];
  for (const record of out.split('\x1e')) {
    const trimmed = record.replace(/^\n+/, '');
    if (!trimmed) continue;
    const fields = trimmed.split('\x1f');
    if (fields.length < 4) continue;
    const [sha, author, time, summary] = fields;
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;
    entries.push({ sha, author, time: Number(time), summary });
  }
  return entries;
}
