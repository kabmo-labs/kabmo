/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Client state for the worktree surfaces: the list, creation and removal.
 *
 * One module for all three because they share the same two facts — the project
 * the request is scoped to and the failure shape the server answers with — and
 * splitting them would put the fetch envelope in three places.
 *
 * Nothing here invents a path: the server resolves the destination from the
 * dialog's NAME and reports back what it used, so the client cannot name a
 * directory outside the project.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { WorktreeFailure, WorktreeInfo, WorktreeListPayload, WorktreeValidation } from '@/shared/lib/workspace/worktree/types';

export interface WorktreeRequestScope {
  /** The project's `project_path`, sent as `?root=`. */
  root: string | null;
  /** Sent as `?folderId=` so an unbound-but-valid folder still resolves. */
  folderId?: number | string | null;
}

function queryFor(scope: WorktreeRequestScope): string {
  const params = new URLSearchParams();
  if (scope.root) params.set('root', scope.root);
  if (scope.folderId !== null && scope.folderId !== undefined) params.set('folderId', String(scope.folderId));
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** A refusal the UI reports verbatim; `field` marks the input that caused it. */
export class WorktreeRequestError extends Error {
  readonly failure: WorktreeFailure;

  constructor(failure: WorktreeFailure) {
    super(failure.message);
    this.name = 'WorktreeRequestError';
    this.failure = failure;
  }
}

async function readFailure(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as (WorktreeFailure & { error?: string }) | null;
  throw new WorktreeRequestError({
    code: body?.code ?? 'create_failed',
    message: body?.message ?? body?.error ?? `HTTP ${response.status}`,
    ...(body?.field ? { field: body.field } : {}),
    ...(body?.count !== undefined ? { count: body.count } : {}),
  });
}

/** The project's worktrees, with the facts each row shows. */
export function useWorktrees(scope: WorktreeRequestScope, enabled: boolean) {
  const [payload, setPayload] = useState<WorktreeListPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<WorktreeFailure | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/worktrees${queryFor(scope)}`);
      if (!response.ok) await readFailure(response);
      setPayload((await response.json()) as WorktreeListPayload);
      setFailure(null);
    } catch (cause) {
      // Kept apart from the payload: an empty list and a failed read are
      // different answers, and only one of them means nothing is there. The
      // CODE travels too, because "this folder is not a repository" and "git
      // could not answer" are different states to draw — and the first one is
      // how a caller knows to offer no worktree control at all.
      setFailure(
        cause instanceof WorktreeRequestError
          ? cause.failure
          : { code: 'create_failed', message: cause instanceof Error ? cause.message : String(cause) },
      );
    } finally {
      setLoading(false);
    }
  }, [enabled, scope.root, scope.folderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    payload,
    worktrees: payload?.worktrees ?? ([] as WorktreeInfo[]),
    /**
     * Whether the project is a git repository at all. `null` while it is still
     * unknown: a caller that draws a worktree control must wait for the answer
     * rather than offer one a plain folder can never satisfy.
     */
    isRepo: payload ? payload.isRepo : null,
    /** The resolved parent directory a create would use. */
    base: payload?.base ?? '',
    loading,
    failure,
    /** The failure's message, for the surfaces that only print one. */
    error: failure?.message ?? null,
    refresh,
  };
}

export interface CreateWorktreeRequest {
  mode: 'new' | 'existing';
  branch?: string;
  worktreeName?: string;
  startRef?: string;
}

/** The plan a create would use, without creating anything. */
export async function validateWorktree(
  scope: WorktreeRequestScope,
  request: CreateWorktreeRequest,
): Promise<WorktreeValidation> {
  const response = await fetch(`/api/worktrees/validate${queryFor(scope)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = (await response.json().catch(() => null)) as WorktreeValidation | null;
  if (!body) return { ok: false, failures: [{ code: 'create_failed', message: `HTTP ${response.status}` }] };
  return body;
}

export async function createWorktree(
  scope: WorktreeRequestScope,
  request: CreateWorktreeRequest,
): Promise<WorktreeInfo> {
  const response = await fetch(`/api/worktrees${queryFor(scope)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) await readFailure(response);
  const body = (await response.json()) as { worktree: WorktreeInfo };
  return body.worktree;
}

export interface RemoveWorktreeResult {
  removed: true;
  archived: string[];
  branchDeleted: boolean;
  branchKept: boolean;
}

export async function removeWorktree(
  scope: WorktreeRequestScope,
  worktreePath: string,
  options: { deleteBranch?: boolean } = {},
): Promise<RemoveWorktreeResult> {
  const response = await fetch(`/api/worktrees${queryFor(scope)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: worktreePath, deleteBranch: options.deleteBranch === true }),
  });
  if (!response.ok) await readFailure(response);
  return (await response.json()) as RemoveWorktreeResult;
}