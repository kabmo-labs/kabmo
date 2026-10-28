/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Navbar session-title state for Kabmo. Owns the optimistic rename
 * override so the header updates live — the sidebar publishes the
 * `session-renamed` client signal after a successful rename, no refetch.
 */

import { useEffect, useState } from 'preact/hooks';
import { isPendingSessionId, pendingSessionTitle } from '@/shared/lib/omp/session/default-title';
import { subscribeClientSignal } from '@/client/lib/signals';

/** Navbar session title: timestamped default while a "new-…" session is pending;
 *  a rename event overrides until the session's own metadata arrives. */
export function useSessionTitle(
  sessionId: string | null,
  serverTitle: string | null | undefined,
  onSessionTitle?: (title: string | null) => void,
): void {
  const [renamedTitle, setRenamedTitle] = useState<string | null>(null);
  // Drop the optimistic override when the user switches sessions.
  useEffect(() => { setRenamedTitle(null); }, [sessionId]);
  // The sidebar publishes `session-renamed` after a successful PATCH so the
  // header updates without refetching the session.
  useEffect(() => subscribeClientSignal('session-renamed', (detail) => {
    if (!detail?.sessionId || !detail.title || String(detail.sessionId) !== String(sessionId)) return;
    setRenamedTitle(detail.title);
  }), [sessionId]);
  useEffect(() => {
    const pending = isPendingSessionId(sessionId) ? pendingSessionTitle(sessionId) : null;
    onSessionTitle?.(pending ?? renamedTitle ?? serverTitle ?? null);
  }, [sessionId, serverTitle, renamedTitle, onSessionTitle]);
}
