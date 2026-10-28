/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two READ actions that travel through the POST action path: a page of
 * commit history / graph, and a file diff for one commit.
 *
 * Split from `git-actions.ts` because they answer with a page rather than
 * performing a mutation, and because the file is at the repo's line ceiling
 * without them. Both were inline branches in `routes/fs/git.ts`.
 */

import { COMMIT_PAGE_SIZE } from '@/shared/lib/fs/commit-page';
import { fetchFileDiff, fetchGitCommits } from '@/server/lib/fs/git-log';
import { fetchWorkingFileDiff } from '@/server/lib/fs/git-diff';

export interface GitReadResult {
  success: true;
  type?: string;
  data?: unknown[];
  hasMore?: boolean;
  total?: number;
  limit?: number;
  skip?: number;
  diff?: string;
}

/** A page of commits, as the history and graph buttons ask for it. */
export async function fetchCommitsPage(
  targetDir: string,
  type: 'history' | 'graph',
  formData: FormData,
): Promise<GitReadResult> {
  const limit = parseInt((formData.get('limit') as string) || String(COMMIT_PAGE_SIZE), 10);
  const skip = parseInt((formData.get('skip') as string) || '0', 10);
  const result = await fetchGitCommits(targetDir, limit, skip);
  return {
    success: true,
    type,
    data: result.commits,
    hasMore: result.hasMore,
    total: result.total,
    limit,
    skip,
  };
}

/**
 * A file's patch — either from one commit (`commit_diff`) or from the working
 * tree / index (`file_diff`).
 *
 * `full=1` is the commit modal's "Expand all context": git's default patch is
 * three lines around the change, so the button needs a re-read rather than a
 * client-side expansion of a payload that holds nothing more.
 */
export async function fetchDiffActions(
  targetDir: string,
  type: 'commit_diff' | 'file_diff',
  formData: FormData,
): Promise<GitReadResult> {
  if (type === 'commit_diff') {
    const hash = (formData.get('hash') as string) || '';
    const file = (formData.get('file') as string) || '';
    const full = formData.get('full') === '1';
    const diff = await fetchFileDiff(targetDir, hash, file, full);
    return { success: true, diff };
  }
  const file = (formData.get('file') as string) || '';
  const staged = formData.get('staged') === '1' || formData.get('staged') === 'true';
  const diffData = await fetchWorkingFileDiff(targetDir, file, staged);
  return { success: true, ...diffData };
}
