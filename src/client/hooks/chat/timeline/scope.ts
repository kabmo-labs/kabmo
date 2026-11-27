/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat's URL scope: which session is open, and which workspace folder the
 * composer is aimed at.
 *
 * Both live in the query string rather than in state, because the layout reads
 * the same params (the right panel scopes to `folderId`) and a reload has to
 * land on the same chat. The folder picker mirrors its choice back into the URL
 * so both readers move together.
 */

import { useCallback } from 'preact/hooks';
import { useSearchParams, type SetSearchParams } from '@/client/lib/router/search-params';

export interface TimelineScope {
  sessionId: string | null;
  folderId: string | null;
  selectedFolderId: number | null;
  selectContextFolder: (id: number | null) => void;
  /** The raw URL setter, for the send path: adopting a freshly spawned session
   *  rewrites `sessionId` in place, and the layout reads the same params. */
  setSearchParams: SetSearchParams;
}

export function useTimelineScope(): TimelineScope {
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const folderId = searchParams.get('folderId');
  // DERIVED, never mirrored into state. The URL is the one value the picker,
  // the prewarm and the send all read; a copy in `useState` synced by an effect
  // lagged it by one render — and the New Chat dialog's first send is
  // dispatched in the very commit that writes `?folderId=`, so it read the
  // PREVIOUS folder and spawned the prompt in another workspace.
  const selectedFolderId = folderId ? parseInt(folderId, 10) : null;

  const selectContextFolder = useCallback(
    (id: number | null) => {
      setSearchParams(
        (prev) => {
          if (id) prev.set('folderId', String(id));
          else prev.delete('folderId');
          return prev;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { sessionId, folderId, selectedFolderId, selectContextFolder, setSearchParams };
}
