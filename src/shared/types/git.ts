export interface GitChange {
  file: string;
  status: 'M' | 'A' | 'D' | '?' | 'R' | 'C' | 'U' | string;
  staged: boolean;
  additions?: number;
  deletions?: number;
}

/**
 * A git operation that stopped and is waiting for a human.
 *
 * `stash-pop` is not a git state name: it is the one conflict shape with NO
 * operation file, so its abort is `git reset --merge HEAD` rather than an
 * `--abort` verb.
 */
export type GitOperation =
  | 'merge'
  | 'rebase'
  | 'rebase-apply'
  | 'cherry-pick'
  | 'revert'
  | 'stash-pop';

/** The state a working tree is in, as the panel's banner reads it. */
export interface GitState {
  operation: GitOperation | null;
  /** Repo-relative paths with unmerged index entries. */
  conflicts: string[];
  /** True when HEAD is detached — the branch read reports the literal `HEAD`. */
  detached: boolean;
}

/** One branch row for the branch management modal. */
export interface GitBranchDetail {
  name: string;
  current: boolean;
  /** `origin/main`, or `''` when the branch has no upstream. */
  upstream: string;
  ahead: number;
  behind: number;
  /** The upstream ref no longer exists on the remote. */
  gone: boolean;
  subject: string;
  date: string;
}

/** One stash entry. */
export interface GitStashEntry {
  /** The selector git accepts back — `stash@{0}`. */
  ref: string;
  subject: string;
  date: string;
}


export interface GitCommitFile {
  file: string;
  status: string;
  additions: number;
  deletions: number;
  diff?: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  /** The subject line only (`%s`). */
  message: string;
  /**
   * Everything after the subject (`%b`), without the trailing newline. Empty
   * for a one-line commit, which is the common case — the row only offers an
   * expand affordance when this is non-empty.
   */
  body?: string;
  parents: string[];
  refs?: string[];
  files?: GitCommitFile[];
  lane?: number;
}

/**
 * One page of commit history, exactly as the git route answers it.
 *
 * `hasMore` and `total` travel WITH the page: `total` is the branch's real
 * commit count (`git rev-list --count HEAD`), not the size of `data`, and a
 * consumer that keeps only `data` cannot tell a 50-commit repo from a page of
 * 50 out of 646.
 */
export interface CommitHistoryPage {
  title: string;
  /** Rows as the route answered them; the modal normalizes them. */
  data: unknown[];
  hasMore?: boolean;
  total?: number;
}

export type GitViewMode = 'flat' | 'tree';

export interface GitTreeNode {
  id: string;
  name: string;
  path: string;
  type: 'folder' | 'file';
  change?: GitChange;
  children: GitTreeNode[];
  changeCount: number;
}

export interface GitStatusData {
  changes: GitChange[];
  branch: string;
  branches: string[];
  repos: string[];
  activeRepo: string;
  syncCount?: { ahead: number; behind: number };
}

export interface FileDiffData {
  file: string;
  diff: string;
  oldContent?: string;
  newContent?: string;
  staged: boolean;
  status: string;
  additions?: number;
  deletions?: number;
}

