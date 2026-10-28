/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A pull request's files and commits.
 *
 * Both are separate collections on GitHub, and both are OPTIONAL to the item
 * itself: a PR whose file list fails (a huge diff, a rate limit) still has a
 * title, a body and a conversation, so a failure here is a note rather than a
 * failed read.
 *
 * The patch text is carried as the host sends it. GitHub omits `patch` for a
 * binary file and for a diff over its own size ceiling, and an absent patch is
 * the signal the panel renders as a name-and-status row instead of an empty code
 * block.
 */

import type { ForgeCommit, ForgeFile } from '../protocol';
import { get, joinUrl, type ForgeContext } from './context';
import { asRecord, count, listAt, text, textAt } from './map';

/** The ceiling both reads ask for: enough for an ordinary change, bounded. */
const MAX_FILES = 100;
const MAX_COMMITS = 50;

function fileOf(raw: unknown): ForgeFile | null {
  const record = asRecord(raw);
  if (!record) return null;
  const path = text(record.filename);
  if (!path) return null;
  return {
    path,
    status: text(record.status, 'modified'),
    additions: count(record.additions, 0),
    deletions: count(record.deletions, 0),
    patch: text(record.patch),
  };
}

function commitOf(raw: unknown): ForgeCommit | null {
  const record = asRecord(raw);
  if (!record) return null;
  const sha = text(record.sha);
  if (!sha) return null;
  const commit = asRecord(record.commit) ?? {};
  const author = asRecord(commit.author) ?? {};
  return {
    sha,
    // Only the first line: a commit body is often a paragraph, and a row is one
    // line. The full message is on the commit's own page.
    message: text(commit.message).split('\n')[0],
    author: text(author.name) || textAt(record.author, 'login', 'unknown'),
    at: text(author.date),
  };
}

export interface PullExtras {
  files: ForgeFile[];
  commits: ForgeCommit[];
}

export async function githubExtras(
  context: ForgeContext,
  id: string,
  notes: string[],
): Promise<PullExtras> {
  const base = `/repos/${context.slug}/pulls/${encodeURIComponent(id)}`;
  const [files, commits] = await Promise.all([
    get(context, joinUrl(context.apiBase, `${base}/files?per_page=${MAX_FILES}`)),
    get(context, joinUrl(context.apiBase, `${base}/commits?per_page=${MAX_COMMITS}`)),
  ]);

  if (!files.ok) notes.push(`files: ${files.message}`);
  if (!commits.ok) notes.push(`commits: ${commits.message}`);

  return {
    files: files.ok
      ? listAt(files.value).flatMap((raw) => {
          const file = fileOf(raw);
          return file ? [file] : [];
        })
      : [],
    commits: commits.ok
      ? listAt(commits.value).flatMap((raw) => {
          const commit = commitOf(raw);
          return commit ? [commit] : [];
        })
      : [],
  };
}
