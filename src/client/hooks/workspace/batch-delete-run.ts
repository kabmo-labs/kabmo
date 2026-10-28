/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The state machine behind a batch delete, shared by both sidebars.
 *
 * It exists so the two layouts cannot drift on the three follow-ups that are
 * load-bearing, and which are easy to get subtly wrong once per sidebar:
 *
 *   - a removed session's client cache is forgotten (`forgetSession`), or every
 *     panel keyed to that id keeps serving the state of a chat that is gone;
 *   - when the removed set includes the session in the URL, `?sessionId=` (and
 *     `?subagent=`, which belongs to it) is dropped — otherwise the chat renders
 *     its "not found" state over a row the user just deleted;
 *   - the sidebar is refreshed ONCE per batch, from the server's own republish.
 *
 * A refusal does not abort the batch: the server already deleted everything it
 * could, and the dialog lists what survived with its reason.
 */

import { useCallback, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import {
  deleteSessionsBatch,
  deleteWorkspacesBatch,
  type BatchDeleteOutcome,
} from '@/client/hooks/workspace/batch-delete';
import type { BatchMode } from '@/shared/lib/workspace/batch-select';

export interface BatchDeleteRun {
  /** The ids awaiting confirmation; empty when the dialog is closed. */
  pending: string[];
  isDeleting: boolean;
  /** The settled result, or null while the request runs. */
  outcome: BatchDeleteOutcome | null;
  /** Open the confirmation for these ids. */
  request: (ids: readonly string[]) => void;
  /** Close it without deleting. */
  cancel: () => void;
  /** Issue the delete. Resolves with the settled outcome (null when nothing ran). */
  confirm: (mode: BatchMode) => Promise<BatchDeleteOutcome | null>;
}

export function useBatchDeleteRun(refresh: () => void): BatchDeleteRun {
  const [pending, setPending] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [outcome, setOutcome] = useState<BatchDeleteOutcome | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const request = useCallback((ids: readonly string[]) => {
    setOutcome(null);
    setPending([...ids]);
  }, []);

  const cancel = useCallback(() => {
    setOutcome(null);
    setPending([]);
  }, []);

  const confirm = useCallback(async (mode: BatchMode): Promise<BatchDeleteOutcome | null> => {
    if (pending.length === 0 || isDeleting) return null;
    setIsDeleting(true);
    setOutcome(null);
    const ids = pending;
    const result = mode === 'workspace'
      ? await deleteWorkspacesBatch(ids)
      : await deleteSessionsBatch(ids);

    if (mode === 'session' && result.removed.length > 0) {
      for (const id of result.removed) forgetSession(id);
      const openSession = searchParams.get('sessionId');
      if (openSession && result.removed.includes(openSession)) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('sessionId');
          next.delete('subagent');
          return next;
        }, { replace: true });
      }
    }

    if (result.removed.length > 0) refresh();
    setOutcome(result);
    setIsDeleting(false);
    // The dialog STAYS open on a refusal so the reason can be read; a fully
    // successful run closes itself, because the rows it named are gone.
    if (result.removed.length === ids.length) setPending([]);
    return result;
  }, [pending, isDeleting, searchParams, setSearchParams, refresh]);

  return { pending, isDeleting, outcome, request, cancel, confirm };
}
