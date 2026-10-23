/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Worktree shapes shared by the server and the client.
 *
 * A worktree session is a normal session whose cwd is a linked checkout, so the
 * only thing that crosses the wire is where it is and whether it is still there
 * — everything else is read from git.
 */

/** One row of `GET /api/worktrees`, and what a create answers with. */
export interface WorktreeInfo {
  /** Absolute, canonical path of the checkout. */
  path: string;
  /** Branch checked out there (`refs/heads/` stripped); `''` when detached. */
  branch: string;
  /** The commit HEAD points at — what a detached row names instead of a branch. */
  head: string;
  detached: boolean;
  /** git reports it prunable, or the directory is gone. */
  missing: boolean;
  /** The main checkout — listed, but never removable. */
  isPrimary: boolean;
  /** Changed + untracked count. */
  dirty: number;
  /**
   * Commits on this branch that are not on the ref it was created from. Gates
   * the delete dialog's branch checkbox, because `git branch -d` refuses an
   * unmerged branch and a checkbox that cannot succeed is worse than none.
   */
  aheadOfStart: number;
  /** The ref recorded when the worktree was created; `''` for an existing branch. */
  startRef: string;
  /** Chats whose cwd is inside this worktree. */
  sessions: number;
}

/**
 * The per-session view, carried on `SessionItemData` so every layout and every
 * plugin reads one field instead of asking git.
 */
export interface SessionWorktreeInfo {
  branch: string;
  /** Canonical worktree root. */
  path: string;
  /** The checkout this worktree belongs to — the folder's `project_path`. */
  primaryRoot: string;
  /** `missing` when git still tracks it but the directory is gone. */
  status: 'ready' | 'missing';
  detached: boolean;
}

/** Where a chat that has not started will run. */
export interface SpawnTarget {
  folderId: number | null;
  /** Absolute worktree path, or null for the folder's own checkout. */
  worktreePath: string | null;
}

/** Why a worktree action was refused. Codes are stable; messages are not. */
export type WorktreeErrorCode =
  | 'not_a_repo'
  | 'no_commits'
  | 'invalid_name'
  | 'branch_exists'
  | 'branch_in_use'
  | 'path_exists'
  | 'create_failed'
  | 'not_a_worktree'
  | 'primary_checkout'
  | 'dirty'
  | 'dirty_carryover'
  | 'remove_failed'
  | 'mock_mode';

/** One refusal, with the field it belongs to so a dialog can mark the input. */
export interface WorktreeFailure {
  code: WorktreeErrorCode;
  message: string;
  field?: 'branch' | 'folder' | 'location';
  /** Present for `dirty`: how many files would be lost. */
  count?: number;
}

/** `GET /api/worktrees`. */
export interface WorktreeListPayload {
  worktrees: WorktreeInfo[];
  /** The resolved parent directory new worktrees are created in. */
  base: string;
  isRepo: boolean;
  /** Present when the listing failed — never substituted with an empty list. */
  error?: string;
}

/** `POST /api/worktrees/validate`. */
export interface WorktreeValidation {
  ok: boolean;
  failures: WorktreeFailure[];
  /** The name and directory the create would use, so the dialog can show them. */
  resolved?: { name: string; directory: string; branch: string };
}