/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Open a FORK as the same pending-chat composer New Session uses.
 *
 * Two entry points share this: the per-message Fork (with an anchor) and the
 * session menu's "Fork chat" (whole chat, no anchor). The pending entry carries
 * the source and the anchor, so the normal empty-workspace composer writes the
 * branch's first turn; the POST happens on SEND, in `pending-dispatch.ts`.
 */

import { startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import { setHarnessPick } from '@/client/hooks/chat/timeline/session-harness';
import { formatNewSessionTitle } from '@/shared/lib/omp/session/default-title';
import type { SetSearchParams } from '@/client/lib/router/search-params';

export interface OpenForkSessionArgs {
  sourceSessionId: string;
  /** The source's agent; the fork cannot change provider. */
  harness?: string;
  folderId: number | string | null;
  /** The row the fork cuts at; null forks the whole chat. */
  anchorEntryId: string | null;
  setSearchParams: SetSearchParams;
}

/** Returns the pending chat's id. */
export function openForkSession(args: OpenForkSessionArgs): string {
  const pendingId = startPendingSession(args.folderId, {
    title: formatNewSessionTitle(new Date(), 'Fork'),
    ...(args.harness ? { harness: args.harness } : {}),
    forkSourceSessionId: args.sourceSessionId,
    ...(args.anchorEntryId ? { forkAnchorEntryId: args.anchorEntryId } : {}),
  });
  // The picker's first tab is the source's agent; the fork cannot change
  // provider because that agent owns the history being branched.
  if (args.harness) setHarnessPick(pendingId, args.harness);
  args.setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('sessionId', pendingId);
    next.set('forkFrom', args.sourceSessionId);
    if (args.anchorEntryId) next.set('forkAt', args.anchorEntryId);
    else next.delete('forkAt');
    next.delete('parentSessionId');
    if (args.folderId !== null && args.folderId !== undefined) next.set('folderId', String(args.folderId));
    return next;
  }, { replace: true });
  return pendingId;
}
