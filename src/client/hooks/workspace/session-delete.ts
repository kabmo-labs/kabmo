/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Session deletion, shared by the desktop session row and the mobile one.
 *
 * Both sidebars render the same confirmation dialog and issue the same request,
 * so the state machine (which row is pending, in-flight, why it was refused)
 * lives here rather than in two components that would drift on the URL, the
 * verb, or the event they dispatch afterwards.
 *
 * Two follow-ups are load-bearing and both happen only on success:
 *
 *   - the server's own `sidebar` republish refreshes the list. The deleted row
 *     is gone from disk, but the client still holds the previous snapshot.
 *   - when the deleted session is the one on screen, `?sessionId=` is dropped.
 *     Leaving the URL pointing at a removed session renders the chat's "not
 *     found" state over a row the user just deleted, and every panel keyed to
 *     that id keeps fetching for it.
 */

import { useCallback, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import type { SessionItemData } from '@/shared/types';

export interface SessionDeleteActions {
  /** The session awaiting confirmation, or null when the dialog is closed. */
  pending: SessionItemData | null;
  /** True while the DELETE request is in flight. */
  isDeleting: boolean;
  /** The server's refusal reason, shown inside the dialog. */
  error: string | null;
  /** Open the confirmation for this session. */
  requestDelete: (session: SessionItemData) => void;
  /** Close it without deleting. */
  cancelDelete: () => void;
  /** Issue the delete. Resolves once the request settled. */
  confirmDelete: () => Promise<void>;
}

export function useSessionDelete(): SessionDeleteActions {
  const [pending, setPending] = useState<SessionItemData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const requestDelete = useCallback((session: SessionItemData) => {
    setError(null);
    setPending(session);
  }, []);

  const cancelDelete = useCallback(() => {
    setError(null);
    setPending(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pending || isDeleting) return;
    const sessionId = String(pending.id);
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        // The refusal reasons the server gives (mid-run, pending chat) are
        // actionable, so they stay on screen instead of closing the dialog.
        setError(body?.error || `Could not delete the session (HTTP ${res.status}).`);
        return;
      }
      forgetSession(sessionId);
      if (searchParams.get('sessionId') === sessionId) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('sessionId');
          // A subagent transcript belongs to the session being removed.
          next.delete('subagent');
          return next;
        }, { replace: true });
      }
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server.');
    } finally {
      setIsDeleting(false);
    }
  }, [pending, isDeleting, searchParams, setSearchParams]);

  return { pending, isDeleting, error, requestDelete, cancelDelete, confirmDelete };
}
