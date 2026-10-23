/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Starting a chat inside a worktree, from either layout's sidebar.
 *
 * Desktop and phone do the same three things in the same order, and the order is
 * what makes it work: prewarm the child in the WORKTREE cwd (not the project's),
 * mint the pending session, write its target BEFORE the URL names it, then
 * navigate. Writing the target afterwards would leave the composer drawing the
 * folder while the send path already had its ref armed for something else — the
 * one outcome the pick exists to prevent.
 *
 * Extracted so both sidebars call one function rather than repeating a sequence
 * whose middle step is invisible when it is wrong.
 */

import { startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import { triggerSessionPrewarm } from '@/shared/lib/omp/session/prewarm';
import { setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { SPAWN_TARGET_KEY } from '@/client/hooks/chat/timeline/spawn-target';

export interface WorktreeSessionDeps {
  setSearchParams: (fn: (prev: URLSearchParams) => URLSearchParams, options?: { replace?: boolean }) => void;
  /** Called after the navigation — the phone closes its drawer here. */
  afterNavigate?: () => void;
}

/**
 * Open a pending chat in `worktreePath`, scoped to `folderId`.
 * Returns the pending session's id, so a caller can report or follow it.
 */
export function startWorktreeSession(
  deps: WorktreeSessionDeps,
  folderId: number,
  worktreePath: string,
): string {
  triggerSessionPrewarm(worktreePath);
  const pendingId = startPendingSession(folderId);
  setSessionKey(pendingId, SPAWN_TARGET_KEY, { folderId, worktreePath });
  deps.setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('sessionId', pendingId);
    next.set('folderId', folderId.toString());
    return next;
  }, { replace: true });
  deps.afterNavigate?.();
  return pendingId;
}