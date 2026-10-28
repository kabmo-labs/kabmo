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

import { useCallback, useEffect, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';

export interface TimelineScope {
  sessionId: string | null;
  folderId: string | null;
  selectedFolderId: number | null;
  selectContextFolder: (id: number | null) => void;
  /** The raw URL setter, for the send path: adopting a freshly spawned session
   *  rewrites `sessionId` in place, and the layout reads the same params. */
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}

export function useTimelineScope(): TimelineScope {
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const folderId = searchParams.get('folderId');
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);

  useEffect(() => {
    setSelectedFolderId(folderId ? parseInt(folderId, 10) : null);
  }, [folderId]);

  const selectContextFolder = useCallback(
    (id: number | null) => {
      setSelectedFolderId(id);
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
