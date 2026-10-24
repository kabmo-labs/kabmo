/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Client-side session-list provider. Reads the sidebar from the unified
 * realtime socket and exposes it through a context so every consumer (desktop
 * sidebar, mobile sidebar, chat timeline, layout headers) shares one value.
 *
 * Two topics, because the two halves change at completely different rates:
 *
 *   - `sidebar` carries the STRUCTURE (folders, their sessions, the sort
 *     order). Producing it runs a full omp JSONL discovery scan, so the server
 *     publishes it only when a session or folder is added or removed.
 *   - `sidebar:status` carries the VOLATILE fields (`streamStatus`,
 *     `awaitingInput`, `runModel`). One SQLite read, published on every
 *     stream-status write — which is what used to be the 8s stream poll and the
 *     30s idle poll.
 *
 * One overlay rides on top, and it can only REMOVE a status: the seen-strip
 * (a one-shot terminal badge this mount already acked), from
 * `sidebar-overlay.ts`. `stream` itself is never invented here — the server's
 * row is the only source, so a run in flight cannot outlive its own row.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createContext } from 'preact/compat';
import type { ReactNode } from 'preact/compat';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { useInputRequiredAlert } from '@/client/hooks/ui/input-required-alert';

import { realtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_SIDEBAR, TOPIC_SIDEBAR_ACTIVITY, TOPIC_SIDEBAR_STATUS } from '@/shared/lib/realtime/protocol';
import {
  applySeenStrip,
  SESSION_TITLE_HINT_SIGNAL,
} from '@/client/hooks/chat/omp/sidebar-overlay';
import { subscribeClientSignal } from '@/client/lib/signals';
import { buildSidebarSessionStatus } from '@/client/hooks/chat/omp/session-statuses';
import type { WorkspaceFolderData } from '@/shared/types';
import type { SidebarActivityPayload, SidebarPayload, SidebarStatusPayload } from '@/shared/types/realtime';

/** Re-exported so a consumer (and a test) names the shape without reaching
 *  into a server module for it. */
export type { SidebarActivityPayload, SidebarPayload, SidebarStatusPayload };

export interface SidebarDataHandle {
  folders: WorkspaceFolderData[];
  isMock: boolean;
  /** True only before the first snapshot lands — drives the skeleton. */
  initializing: boolean;
  /** True when the socket is down or a sequence gap was seen. */
  stale: boolean;
  /**
   * Ask the server for fresh snapshots of both topics. A call arriving while a
   * snapshot is in flight is coalesced by the transport, so this is safe to
   * call from a click and from an effect alike.
   */
  refresh: () => void;
  /**
   * User-initiated refresh: the same request as `refresh`, but it raises
   * `refreshing` until the next snapshot lands, so a toolbar button can spin
   * while it runs. The background paths deliberately never raise the flag — a
   * spinner that turns on by itself reads as a broken list.
   */
  refreshNow: () => void;
  /** True while a `refreshNow` is waiting on its snapshot. */
  refreshing: boolean;
  /**
   * The indicator a toolbar button should render: a user's `refreshNow` in
   * flight, OR a beat after any structure push landed — a tool call advances
   * the list too, and the button must show it moved without the user asking.
   */
  isRefreshing: boolean;
  /**
   * Mark a session's one-shot terminal badge as seen NOW: strips the check
   * optimistically for this mount and POSTs the server ack. No-op unless the
   * session currently carries a terminal (`finish`/`abort`) status.
   */
  markSeen: (sessionId: number | string) => void;
  /** True when markSeen already ran for this session on this mount. */
  hasSeen: (sessionId: number | string) => boolean;
  /**
   * The authoritative `sessionId → streamStatus` map, merged from the
   * `sidebar:status` topic and already carrying the seen-strip. This is the
   * ONLY run-in-flight source: the server writes the `stream` row at prompt
   * dispatch, so the sidebar's spinner and the chat's generating indicator
   * read the same answer.
   */
  streamStatusMap: Record<string, 'stream' | 'finish' | 'abort'>;
  /**
   * Text the user just sent for this session, shown by the sidebar's
   * PLACEHOLDER row while omp's transcript scan cannot name the session yet
   * (omp creates the file only at the first assistant message). Undefined once
   * the real row exists — the placeholder is not drawn then.
   */
  titleHint: (id: number | string | null | undefined) => string | undefined;
}

const SidebarDataContext = createContext<SidebarDataHandle | null>(null);

/** Merge a structure payload with the volatile map, by session id. */
function mergeStatus(
  folders: WorkspaceFolderData[],
  status: SidebarStatusPayload | null,
): WorkspaceFolderData[] {
  if (!status) return folders;
  return folders.map((folder) => ({
    ...folder,
    sessions: (folder.sessions ?? []).map((session) => {
      const volatile = status[String(session.id)];
      return volatile ? { ...session, ...volatile } : session;
    }),
  }));
}

/**
 * Advance each row's live fields from the activity payload.
 *
 * `sidebar:activity` carries only the RUNNING sessions (see its doc), so an id
 * it does not name keeps whatever the structure gave it. Three rules, each of
 * which is a way this can go wrong:
 *
 *   - the `updated_at` comparison is what makes two sources safe to
 *     interleave: the structure is re-scanned at every turn boundary and may
 *     already carry a stamp this payload has not caught up with, and a late
 *     activity frame must never move a row BACKWARDS (that reorders the
 *     sidebar under the reader);
 *   - `hasSubagents` only ever turns ON, because the payload is a live read of
 *     what is on disk and a subagent transcript does not disappear when its run
 *     ends — a `false` here is "not seen yet", not "none exist";
 *   - nothing else is touched. Every other field of a row changes on a
 *     STRUCTURAL event, and those publish the structure for their own reason.
 */
function mergeActivity(
  folders: WorkspaceFolderData[],
  activity: SidebarActivityPayload | null,
): WorkspaceFolderData[] {
  if (!activity) return folders;
  let changed = false;
  const merged = folders.map((folder) => ({
    ...folder,
    sessions: (folder.sessions ?? []).map((session) => {
      const live = activity[String(session.id)];
      if (!live) return session;
      const updated_at = live.updatedAt && isNewerStamp(live.updatedAt, session.updated_at)
        ? live.updatedAt
        : session.updated_at;
      const hasSubagents = session.hasSubagents || live.hasSubagents === true;
      if (updated_at === session.updated_at && hasSubagents === Boolean(session.hasSubagents)) return session;
      changed = true;
      return { ...session, updated_at, hasSubagents };
    }),
  }));
  // A stable identity matters: the sidebar's own `useMemo` chain (filter, sort,
  // pending overlay) keys on this array, and returning a fresh one per activity
  // frame would re-sort 731 rows for a stamp that did not move.
  return changed ? merged : folders;
}

/** Whether `next` is a later ISO stamp than `current`. An absent current is older. */
function isNewerStamp(next: string, current?: string): boolean {
  if (!current) return true;
  const nextMs = Date.parse(next);
  const currentMs = Date.parse(current);
  // An unparseable value on either side is not evidence of a newer stamp; the
  // structure's own field stays authoritative.
  if (!Number.isFinite(nextMs) || !Number.isFinite(currentMs)) return false;
  return nextMs > currentMs;
}

export function SidebarDataProvider({ children, initialFolders = [] }: { children: ReactNode; initialFolders?: WorkspaceFolderData[] }) {
  const structure = useRealtimeTopic<SidebarPayload>(TOPIC_SIDEBAR);
  const status = useRealtimeTopic<SidebarStatusPayload>(TOPIC_SIDEBAR_STATUS);
  const activity = useRealtimeTopic<SidebarActivityPayload>(TOPIC_SIDEBAR_ACTIVITY);

  // Session ids whose badge the user has already dismissed on this mount.
  // Optimistic strip: keeps the click→disappearance instant and stops the
  // pending ack effect in useSessionStatusAck from double-POSTing.
  const seenRef = useRef<Set<string>>(new Set());
  // Text the user just sent, by session id — shown by the placeholder row until
  // omp's transcript scan can name the session (its file appears only at the
  // first assistant message). Dropped when the real row arrives.
  const titleHintRef = useRef<Map<string, string>>(new Map());
  // The refs above are deliberately not reactive; this bumps a render when one
  // of them changes so the overlays below re-apply. Read only as a dependency.
  const [overlayVersion, setOverlayVersion] = useState(0);

  const folders = useMemo(
    () => mergeActivity(mergeStatus(structure.data?.folders ?? initialFolders, status.data), activity.data),
    [structure.data, status.data, activity.data, initialFolders],
  );
  const isMock = structure.data?.isMock ?? false;
  const initializing = structure.data === null;

  // The text the user just sent, for the placeholder row that stands in until
  // omp's transcript scan can name the session.
  useEffect(() => subscribeClientSignal(SESSION_TITLE_HINT_SIGNAL, (detail) => {
    // Trimmed here as well as at the dispatcher: a whitespace-only title would
    // render as a blank placeholder row, which is worse than showing the
    // timestamped default it stands in for.
    const title = detail?.title?.trim();
    if (!detail?.sessionId || !title) return;
    const key = String(detail.sessionId);
    if (titleHintRef.current.get(key) === title) return;
    titleHintRef.current.set(key, title);
    setOverlayVersion((v) => v + 1);
  }), []);

  // A hint lives only until omp's transcript scan surfaces the session; the
  // real row carries the real title, and the placeholder is not drawn.
  useEffect(() => {
    if (!status.data || titleHintRef.current.size === 0) return;
    const listed = new Set<string>();
    for (const folder of folders) {
      for (const session of folder.sessions ?? []) listed.add(String(session.id));
    }
    let dropped = false;
    for (const key of titleHintRef.current.keys()) {
      if (listed.has(key)) {
        titleHintRef.current.delete(key);
        dropped = true;
      }
    }
    if (dropped) setOverlayVersion((v) => v + 1);
  }, [status.data, folders]);

  const refresh = useCallback(() => {
    realtimeClient.refresh(TOPIC_SIDEBAR);
    realtimeClient.refresh(TOPIC_SIDEBAR_STATUS);
    // The activity stamps are what a tool call advances, so a manual refresh
    // that skipped them would re-read the list and leave its labels where they
    // were.
    realtimeClient.refresh(TOPIC_SIDEBAR_ACTIVITY);
  }, []);

  // The spinner follows a user's click only: it is raised here and lowered when
  // the next structure snapshot arrives (the status snapshot may land first, and
  // the list is what the user is looking at).
  const [refreshing, setRefreshing] = useState(false);
  const refreshNow = useCallback(() => {
    setRefreshing(true);
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (refreshing) setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure.data]);

  // A background push — every tool call advances a live session's activity —
  // pulses the topic's own indicator, so the toolbar button spins for it too.
  // Without this the list moved with nothing on screen saying so.
  const isRefreshing = refreshing || structure.refreshing || activity.refreshing;

  // Fires for ANY session, including one this tab never opened — the cue that an
  // agent is blocked on an answer must not depend on the open timeline.
  useInputRequiredAlert(folders);

  const markSeen = useCallback((sessionId: number | string) => {
    const key = String(sessionId);
    const current = folders
      .flatMap((f) => f.sessions ?? [])
      .find((s) => String(s.id) === key)?.streamStatus;
    // Only terminal badges ack; `stream` rows must survive until agent_end.
    if (!current || current === 'stream' || seenRef.current.has(key)) return;
    seenRef.current.add(key);
    setOverlayVersion((v) => v + 1);
    fetch(`/api/sessions/${encodeURIComponent(key)}/stream-seen`, { method: 'POST' })
      .catch(() => {
        // Server still owns the badge; the next open re-acks.
        seenRef.current.delete(key);
        setOverlayVersion((v) => v + 1);
      });
  }, [folders]);

  const value = useMemo<SidebarDataHandle>(() => {
    const seen = seenRef.current;
    // A session that streams again earns a fresh badge lifecycle: forget the
    // ack from an earlier run. Without this, a session opened with a terminal
    // badge stays stripped for the whole mount — its spinner never renders no
    // matter how many snapshots arrive, and only a page reload (fresh mount)
    // brings it back.
    if (seen.size) {
      for (const folder of folders) {
        for (const session of folder.sessions ?? []) {
          if (session.streamStatus === 'stream') seen.delete(String(session.id));
        }
      }
    }
    // The authoritative status map. Built from the merged folders AND the raw
    // status payload, because a session the structure has not scanned yet (a
    // fresh spawn: omp writes its file only at the first assistant message) has
    // no row to merge onto — its `stream` row is in the payload all the same,
    // and the sidebar's PLACEHOLDER row needs it to draw a spinner.
    const streamStatusMap = buildSidebarSessionStatus(folders);
    for (const [id, entry] of Object.entries(status.data ?? {})) {
      if (entry.streamStatus) streamStatusMap[id] = entry.streamStatus;
    }
    // The one overlay: a one-shot terminal badge this mount already acked. It
    // can only REMOVE a status — `stream` itself is never invented client-side,
    // so the spinner and the generating indicator stop when the server's row
    // says the run is over, and never a moment later.
    const stripped = applySeenStrip(folders, seen);
    for (const key of seen) {
      if (streamStatusMap[key] && streamStatusMap[key] !== 'stream') delete streamStatusMap[key];
    }
    return {
      folders: stripped,
      streamStatusMap,
      isMock,
      initializing,
      stale: structure.stale || status.stale,
      refresh,
      refreshNow,
      refreshing,
      isRefreshing,
      markSeen,
      hasSeen: (id) => seen.has(String(id)),
      titleHint: (id) => (id === null || id === undefined ? undefined : titleHintRef.current.get(String(id))),
    };
    // `overlayVersion` is the re-render trigger for the two refs above.
  }, [folders, isMock, initializing, structure.stale, status.stale, structure.refreshing, refresh, refreshNow, refreshing, isRefreshing, markSeen, overlayVersion]);

  return <SidebarDataContext.Provider value={value}>{children}</SidebarDataContext.Provider>;
}

/**
 * Context accessor with a graceful fallback for consumers mounted outside the
 * provider (keeps legacy prop-driven trees working during the transition).
 */
export function useSidebarData(): SidebarDataHandle {
  const value = useContext(SidebarDataContext);
  if (value) return value;
  return {
    folders: [],
    streamStatusMap: {},
    isMock: false,
    initializing: true,
    stale: false,
    refresh: () => {},
    refreshNow: () => {},
    refreshing: false,
    isRefreshing: false,
    markSeen: () => {},
    hasSeen: () => false,
    titleHint: () => undefined,
  };
}
