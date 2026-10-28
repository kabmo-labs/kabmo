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
 * forked: the desktop force-expands search hits, while the mobile sidebar
 * delegates selection to its layout and closes the drawer afterwards. A
 * PENDING row is not one of the differences — it comes from the client-side
 * store (`pending-sessions.ts`) for both layouts, because the row a new chat
 * needs while omp has not written its transcript yet is the same row on a
 * phone and on a desktop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { DEFAULT_SESSION_SORT_OPTION, isValidSessionSortOption, sortFolders } from '@/shared/lib/workspace/sidebar-sort';
import { useSessionStatusAck } from '@/client/hooks/chat/omp/session-statuses';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import {
  hydratePendingSession,
  reconcilePendingSessions,
  usePendingSessions,
} from '@/client/hooks/chat/omp/pending-sessions';
import { markPendingSessionWaiting } from '@/client/hooks/chat/omp/pending-waiting';
import { useWaitingPrompts } from '@/client/hooks/chat/waiting/store';
import { withPendingRows } from '@/client/hooks/chat/omp/pending-rows';
import { useFolderAutoExpand } from '@/client/hooks/chat/omp/folder-auto-expand';
import { writeSetting } from '@/shared/lib/settings/client';
import { subscribeSessionKey } from '@/shared/lib/workspace/session-state/listeners';
import { CHAT_DRAFT_ATTACHMENTS_KEY, CHAT_DRAFT_KEY } from '@/shared/lib/chat/composer/draft';
import type { SessionSortOption, WorkspaceFolderData } from '@/shared/types';

/** Debounce before the sort preference is POSTed to /api/settings (ms). */
const SORT_PERSIST_DEBOUNCE_MS = 200;

export interface SessionSidebarControllerOptions {
  /**
   * Desktop only: force-expand search matches and keep a folder whose name
   * matched even when no session inside it did. The mobile drawer filters
   * without expanding, and drops a folder that has nothing left to show.
   */
  expandSearchMatches?: boolean;
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
  const { expandSearchMatches = false, onSelectSession, onAfterSelect } = options;
  const { folders, initializing, refresh, refreshNow, refreshing, isRefreshing, markSeen, hasSeen, streamStatusMap, titleHint } = useSidebarData();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionParam = searchParams.get('sessionId');
  // Read as a string, never off the `searchParams` object: `useSearchParams`
  // returns a fresh `URLSearchParams` every render, so an effect or memo keyed
  // on it would re-run on every render instead of on the parameter moving.
  const folderIdParam = searchParams.get('folderId');
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
  // The rows render from THIS map, not from an item's own `streamStatus`, and a
  // pending row is injected into `processedFolders` — outside `folders` — so the
  // map has to carry a session the structure has not scanned yet. It is the
  // provider's authoritative map (status payload + structure), never a
  // client-side guess: `stream` exists only where the server wrote it.
  const sessionStatus = streamStatusMap;
  // hasSeen: clicks already acked + optimistically stripped these badges, so
  // the effect must not re-POST while the authoritative list is still stale.
  useSessionStatusAck(sessionStatus, activeSessionId, revalidate, hasSeen);

  // A chat omp has not written a transcript for yet. The store owns the row's
  // whole life — see `pending-sessions.ts` — so the sidebar only reads it here.
  const pendingEntries = usePendingSessions();
  // A held prompt is a property of the SERVER row, not of this tab: a reload (or
  // a second tab) re-enters a pending chat whose wait it never created, and the
  // row has to keep saying what it waits for. The cue is therefore re-stamped
  // from the list on every publish, and cleared when the row is gone.
  const { prompts: waitingPrompts, loaded: waitingLoaded } = useWaitingPrompts();
  const runningIds = useMemo(
    () => new Set(Object.entries(sessionStatus).filter(([, status]) => status === 'stream').map(([id]) => id)),
    [sessionStatus],
  );
  // A folder hosting a run in flight, or a brand-new chat's row, opens itself
  // and stays open — see `folder-auto-expand.ts` for the edge rules.
  const runningFolderIds = useFolderAutoExpand({
    folders,
    initializing,
    runningIds,
    pendingEntries,
    activeId: sessionParam,
    urlFolderId: folderIdParam,
  });

  // The URL is the other way a pending chat exists: a reload (or a second tab)
  // re-enters `?sessionId=new-…` with an empty store. An id the structure does
  // not carry and the store does not know is registered, so the row survives
  // the reload and — when its run is live — a switch away from it.
  useEffect(() => {
    if (!sessionParam || initializing) return;
    if (folders.some((folder) => (folder.sessions ?? []).some((s) => String(s.id) === sessionParam))) return;
    hydratePendingSession(sessionParam, folderIdParam, sessionStatus[sessionParam] === 'stream');
  }, [sessionParam, folders, initializing, folderIdParam, sessionStatus]);

  // The cue is STAMPED from the server list, never cleared from an absence.
  //
  // An absence is not evidence: the effect runs on the render a hold triggers,
  // one frame before the topic's first snapshot, and a snapshot resolved before
  // the create does not carry the row either. Clearing on that deleted the cue
  // the user had just made — and, with it, the id the dispatch watcher needs to
  // adopt. A wait ENDS through a terminal row, which the watcher
  // (`waiting/dispatch.ts`) reads: dispatched, cancelled or failed.
  useEffect(() => {
    if (initializing || !waitingLoaded) return;
    for (const entry of pendingEntries) {
      const id = String(entry.id);
      const held = waitingPrompts.find((prompt) => prompt.pendingId === id && prompt.status === 'waiting');
      if (!held || entry.waiting?.waitId === held.id) continue;
      markPendingSessionWaiting(id, {
        waitId: held.id,
        dependsOn: held.dependsOn,
        dependsOnTitle: held.dependsOnTitle,
      });
    }
  }, [pendingEntries, waitingPrompts, waitingLoaded, initializing]);

  // A pending chat's row is kept only while its draft still holds something,
  // so the reconcile below has to re-run when a draft SLOT moves — the blob
  // arriving is the common case (a chat opened and left empty has its entry
  // seeded by that fetch, and the row must go), and a deletion of the last
  // character is the other. Only the two draft keys are watched: any other slot
  // of a pending chat says nothing about its row.
  const [draftRevision, setDraftRevision] = useState(0);
  // Keyed on the ID LIST, not on the array: `usePendingSessions` hands back a
  // fresh array on every store emit, so depending on it directly would tear
  // down and re-add every subscription on each unrelated notification.
  const pendingIdsKey = pendingEntries.map((entry) => String(entry.id)).join('\n');
  useEffect(() => {
    const bump = () => setDraftRevision((n) => n + 1);
    const unsubscribes = pendingIdsKey.split('\n').filter(Boolean).flatMap((id) => [
      subscribeSessionKey(id, CHAT_DRAFT_KEY, bump),
      subscribeSessionKey(id, CHAT_DRAFT_ATTACHMENTS_KEY, bump),
    ]);
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [pendingIdsKey]);

  // Drop what the authoritative list superseded, plus drafts the user left
  // behind. Runs BEFORE the render below reads the entries, so a row omp has
  // just written is never drawn twice — and the open session's own row is
  // exempt, because that is the row the user is looking at.
  useEffect(() => {
    if (initializing) return;
    const listed = new Set<string>();
    for (const folder of folders) {
      for (const session of folder.sessions ?? []) listed.add(String(session.id));
    }
    reconcilePendingSessions({ listed, running: runningIds, activeId: sessionParam });
  }, [folders, initializing, runningIds, sessionParam, draftRevision]);

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
    // A pending row joins the list BEFORE the filter: the row exists because
    // omp's transcript scan cannot see the session yet, and a row that the
    // user's own search hides is a row the search never offered to find.
    let result = withPendingRows(folders, pendingEntries, {
      activeId: sessionParam,
      urlFolderId: folderIdParam,
      titleFor: titleHint,
    });

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (expandSearchMatches) {
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

    // A run in flight opens its folder in the SAME frame the spinner appears,
    // and keeps it open if the toggle write is refused. The write below makes
    // the flag durable; this makes it immediate.
    if (runningFolderIds.size > 0) {
      result = result.map((folder) => (
        runningFolderIds.has(String(folder.id)) ? { ...folder, isExpanded: true } : folder
      ));
    }

    // Ordering is shared with the other sidebar so the two cannot drift.
    result = sortFolders(result, sortOption);

    return result;
  }, [folders, pendingEntries, searchQuery, sortOption, sessionParam, folderIdParam, expandSearchMatches, titleHint, runningFolderIds]);

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
