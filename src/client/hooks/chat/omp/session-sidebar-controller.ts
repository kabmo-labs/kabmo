/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared session-sidebar controller for the desktop and mobile sidebars.
 *
 * Owns the pieces both sidebars used to clone: the sort preference (seeded
 * from the server, debounced persistence), search state, the filtered/sorted
 * folder list, the live session-status wiring (ack + realtime topics), and
 * session selection.
 *
 * The two sidebars differ in two places, both parameterised here rather than
 * forked: the desktop injects a pending-session placeholder and force-expands
 * search hits, while the mobile sidebar delegates selection to its layout and
 * closes the drawer afterwards.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { DEFAULT_SESSION_SORT_OPTION, isValidSessionSortOption, sortFolders } from '@/shared/lib/workspace/sidebar-sort';
import { pendingSessionCreatedAt, pendingSessionTitle, sessionIdEpochMs } from '@/shared/lib/omp/session/default-title';
import { useSessionStatusAck } from '@/client/hooks/chat/omp/session-statuses';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { writeSetting } from '@/shared/lib/settings/client';
import type { SessionItemData, SessionSortOption, WorkspaceFolderData } from '@/shared/types';

/** Debounce before the sort preference is POSTed to /api/settings (ms). */
const SORT_PERSIST_DEBOUNCE_MS = 200;

export interface SessionSidebarControllerOptions {
  /**
   * Desktop only: inject a pending `new-…` session placeholder and force-expand
   * search matches. Mobile filters without expanding.
   */
  includePendingSessions?: boolean;
  /**
   * Mobile only: hand selection to the layout (which owns the URL + screen),
   * instead of performing the URL swap here.
   */
  onSelectSession?: (id: number | string) => void;
  /** Called after selection — mobile closes the drawer here. */
  onAfterSelect?: () => void;
}

export interface SessionSidebarController {
  folders: WorkspaceFolderData[];
  initializing: boolean;
  refresh: () => void;
  /** User-initiated refresh — raises `refreshing` until that load settles. */
  refreshNow: () => void;
  /** True while a `refreshNow` load is in flight (drives the toolbar spinner). */
  refreshing: boolean;
  /** The toolbar indicator: `refreshing`, OR a beat after any structure push. */
  isRefreshing: boolean;
  activeSessionId: number | string | null;
  sessionParam: string | null;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  showArchived: boolean;
  setShowArchived: (value: boolean) => void;
  optionsOpen: boolean;
  setOptionsOpen: (value: boolean) => void;
  sortOption: SessionSortOption;
  handleSortChange: (opt: SessionSortOption) => void;
  processedFolders: WorkspaceFolderData[];
  sessionStatus: Record<string, 'stream' | 'finish' | 'abort'>;
  handleSelectSession: (id: number | string) => void;
}

export function useSessionSidebarController(
  appSettings: Record<string, any> = {},
  options: SessionSidebarControllerOptions = {},
): SessionSidebarController {
  const { includePendingSessions = false, onSelectSession, onAfterSelect } = options;
  const { folders, initializing, refresh, refreshNow, refreshing, isRefreshing, markSeen, hasSeen, streamStatusMap, titleHint } = useSidebarData();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionParam = searchParams.get('sessionId');
  const activeSessionId = sessionParam
    ? (Number.isNaN(Number(sessionParam)) ? sessionParam : Number(sessionParam))
    : null;

  // A stable refresh reference keeps the ack hook subscribed once while always
  // calling the latest refresh.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  // Folder structure rides the realtime `sidebar` topic, whose server-side
  // writers (create/delete/pin/toggle/settings) publish on their own writes —
  // so there is no window event to listen for any more.
  const revalidate = useCallback(() => refreshRef.current(), []);

  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Seeded from the server (app_settings.omp_sidebar_sort) so the SSR HTML and
  // the first client render agree. With no stored preference the sidebar opens
  // on the newest session activity (see DEFAULT_SESSION_SORT_OPTION).
  const [sortOption, setSortOption] = useState<SessionSortOption>(() =>
    isValidSessionSortOption(appSettings.omp_sidebar_sort) ? appSettings.omp_sidebar_sort : DEFAULT_SESSION_SORT_OPTION,
  );

  const sortPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistSort = useCallback((opt: SessionSortOption) => {
    if (sortPersistTimerRef.current) clearTimeout(sortPersistTimerRef.current);
    sortPersistTimerRef.current = setTimeout(() => {
      writeSetting('omp_sidebar_sort', opt);
    }, SORT_PERSIST_DEBOUNCE_MS);
  }, []);

  useEffect(() => () => {
    if (sortPersistTimerRef.current) clearTimeout(sortPersistTimerRef.current);
  }, []);

  const handleSortChange = (opt: SessionSortOption) => {
    setSortOption(opt);
    setOptionsOpen(false);
    persistSort(opt);
  };

  // Live session status — server-tracked via SQLite and pushed over the
  // realtime socket. Spinner while `stream`; a one-shot terminal badge
  // (acknowledged server-side on open, dropped by the next snapshot).
  //
  // The rows render from THIS map, not from an item's own `streamStatus`, and
  // the pending placeholder is built in `processedFolders` — outside `folders` —
  // so the map has to carry a session the structure has not scanned yet. It is
  // the provider's authoritative map (status payload + structure), never a
  // client-side guess: `stream` exists only where the server wrote it.
  const sessionStatus = streamStatusMap;
  // hasSeen: clicks already acked + optimistically stripped these badges, so
  // the effect must not re-POST while the authoritative list is still stale.
  useSessionStatusAck(sessionStatus, activeSessionId, revalidate, hasSeen);

  const handleSelectSession = (id: number | string) => {
    // One-shot terminal badge (check) clears on open: optimistic strip + server
    // ack. Keep BEFORE the URL swap so the click feels instant.
    markSeen(id);
    if (onSelectSession) {
      onSelectSession(id);
    } else {
      setSearchParams(prev => {
        prev.set('sessionId', id.toString());
        // Navigating away from a session must also exit its transcript view.
        if (prev.has('subagent')) prev.delete('subagent');
        return prev;
      }, { replace: true });
    }
    onAfterSelect?.();
  };

  // Filter and sort folders
  const processedFolders = useMemo(() => {
    let result = [...folders];

    if (includePendingSessions) {
      // The active session may not be in the sidebar list yet: a pending
      // "new-…" session, or a freshly spawned omp session whose JSONL has not
      // been scanned (the realtime sidebar topic surfaces it once it is).
      // Render it with the timestamped default title so there is never a gap
      // between sending a chat and the session appearing with its real title.
      const sessionExists = result.some(f => f.sessions?.some((s) => String(s.id) === String(sessionParam)));
      const pendingId = sessionParam && !sessionExists ? sessionParam : null;
      if (pendingId) {
        const folderIdParam = searchParams.get('folderId');
        const target = folderIdParam
          ? result.find(f => String(f.id) === String(folderIdParam))
          : result[0];
        // The placeholder only bridges the gap before the JSONL scan surfaces
        // the real row; rendering it alongside a row the folder already lists
        // is what made the item blink.
        const alreadyListed = Boolean(
          target?.sessions?.some((s) => String(s.id) === String(pendingId)),
        );
        if (target && !alreadyListed) {
          // The stamp is the session's own creation clock, never `Date.now()`:
          // a re-stamp on every revalidate advanced the title's seconds on each
          // list refresh and made the row perpetually newest, re-shuffling
          // LATEST_SESSION ordering mid-run. A pending id carries its epoch
          // directly; an adopted omp UUID carries one in its v7 prefix, which
          // is what the row needs while omp's transcript scan cannot see the
          // session yet (the file appears only at the first assistant message).
          const epochMs = pendingSessionCreatedAt(pendingId);
          const stableMs = Number.isFinite(epochMs) ? epochMs : sessionIdEpochMs(pendingId);
          const stamp = new Date(Number.isFinite(stableMs) ? stableMs : Date.now()).toISOString();
          result = result.map(f => {
            if (f.id !== target.id) return f;
            const pending: SessionItemData = {
              id: pendingId,
              folder_id: f.id,
              // The text the user just sent beats a clock: omp's own title is
              // ~17s away (its first write), and the operator's words are
              // already known here.
              title: titleHint(pendingId) ?? pendingSessionTitle(pendingId),
              // Read by @/shared/lib/workspace/sidebar-sort to rank this folder newest.
              created_at: stamp,
              updated_at: stamp,
            };
            return { ...f, isExpanded: true, sessions: [pending, ...(f.sessions || [])] };
          });
        }
      }
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (includePendingSessions) {
        result = result.filter(folder => {
          const matchFolder = folder.name.toLowerCase().includes(q);
          const matchSession = folder.sessions?.some((s) => s.title.toLowerCase().includes(q));
          return matchFolder || matchSession;
        }).map(folder => {
          // If we are searching, we also filter the sessions within the folder
          const filteredSessions = folder.sessions?.filter((s) =>
            folder.name.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)
          );
          return { ...folder, sessions: filteredSessions, isExpanded: true };
        });
      } else {
        result = result.map(folder => {
          const matchesFolderName = folder.name.toLowerCase().includes(q);
          const filteredSessions = (folder.sessions || []).filter(s =>
            s.title.toLowerCase().includes(q)
          );
          if (matchesFolderName) return folder;
          return { ...folder, sessions: filteredSessions };
        }).filter(f => f.sessions && f.sessions.length > 0);
      }
    }

    // Ordering is shared with the other sidebar so the two cannot drift.
    result = sortFolders(result, sortOption);

    return result;
  }, [folders, searchQuery, sortOption, sessionParam, searchParams, includePendingSessions, titleHint]);

  return {
    folders,
    initializing,
    refresh: revalidate,
    refreshNow,
    refreshing,
    isRefreshing,
    activeSessionId,
    sessionParam,
    searchQuery,
    setSearchQuery,
    showArchived,
    setShowArchived,
    optionsOpen,
    setOptionsOpen,
    sortOption,
    handleSortChange,
    processedFolders,
    sessionStatus,
    handleSelectSession,
  };
}
