/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Older-window pagination for Kabmo timeline: pages
 * `/api/chat/:id?before=` into the head of the message list and keeps the
 * viewport anchored on the rows the user was reading. Extracted from
 * useSessionLoad so that hook stays under the repo's per-file size ceiling.
 *
 * The same cursor serves the jump rail: a turn the user picks from the FULL
 * history is usually not mounted yet (the timeline only holds the newest
 * window plus whatever was paged in), so {@link SessionPagination.jumpToTurn}
 * pages contiguous windows from the head until that turn's row exists. Windows
 * must stay contiguous — a middle window fetched straight to the target would
 * leave a hole in the timeline — so the jump walks the cursor down, one bounded
 * chunk per request instead of the default page size.
 */

import type { Dispatch, RefObject, SetStateAction } from 'preact/compat';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ChatMessageData } from '@/shared/types';

export interface UseSessionPaginationDeps {
  sessionId: string | null;
  /** Live session id, read when the page response lands: a window fetched for
   *  the previous session is worse than a dropped page. */
  sessionIdRef: { current: string | null };
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  /** Scroll container of the timeline: lets loadOlder preserve the viewport
   *  position when older rows are prepended above it. */
  scrollRef?: RefObject<HTMLDivElement>;
  /** Scroll hook's bottom-jump guard: history paging stands down while a jump
   *  to the tail is settling, so the jump does not race a window it never
   *  asked for (the jump starts at the top, where the trigger lives). */
  jumpActiveRef?: RefObject<boolean>;
  /** Scroll hook's bottom-jump counter: a page request stamps its viewport
   *  anchor with the count it saw and drops the anchor when it has moved on.
   *  The anchor exists to hold a READING position, and applying it over a jump
   *  the user asked for parked the viewport back where they used to be. */
  jumpCountRef?: RefObject<number>;
}

export interface SessionPagination {
  hasMore: boolean;
  loadingOlder: boolean;
  /** Sticky failure flag for the "Load earlier messages" affordance: a failed
   *  page fetch must keep the button visible (retryable) instead of silently
   *  dropping hasMore, which made the button vanish with no feedback. */
  loadOlderError: boolean;
  loadOlder: () => void;
  /** Reach a user turn by paging history until its row is mounted. Returns
   *  whether the row was reached; a turn inside the mounted window (or a live
   *  row, `index < 0`) needs no paging and is not this hook's concern. */
  jumpToTurn: (id: string, index: number) => Promise<boolean>;
  /** Forget the cursor and the retry flag — a window belongs to one session. */
  resetPages: () => void;
  /** Adopt the window metadata a session load returned. */
  applyWindow: (hasMore: unknown, oldestIndex: unknown) => void;
}

/** Messages one jump request may pull. Larger than the default page so a jump
 *  is a few round trips instead of dozens, small enough that no single payload
 *  mounts an unbounded slice of the session. */
const JUMP_CHUNK_MESSAGES = 300;

/** Ceiling on jump requests: a cursor that refuses to advance (a server window
 *  that keeps re-serving the same slice) must end the walk, not spin. */
const JUMP_MAX_REQUESTS = 40;

interface WindowPayload {
  messages: ChatMessageData[];
  hasMore?: boolean;
  oldestIndex?: number;
}

export function useSessionPagination(deps: UseSessionPaginationDeps): SessionPagination {
  const { sessionId, sessionIdRef, setLocalMessages, scrollRef, jumpActiveRef: bottomJumpActiveRef, jumpCountRef } = deps;

  const [hasMore, setHasMore] = useState(false);
  const [oldestIndex, setOldestIndex] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadOlderError, setLoadOlderError] = useState(false);
  // Bumped on every successful older-window prepend; the scroll-anchor layout
  // effect keys on it (its other deps have stable identities, so it needs an
  // explicit change signal per commit).
  const [prependTick, setPrependTick] = useState(0);
  const loadingOlderRef = useRef(false);
  // True from a jump's first request until its target scroll has settled. A
  // jump prepends rows above a viewport that is still parked near the top, so
  // the scroll handler would read "the user reached the top" and page an extra
  // window nobody asked for — and that window's own scroll anchor would fight
  // the jump's.
  const railJumpActiveRef = useRef(false);
  // Live cursor: a jump walks it across several requests, and state does not
  // update between iterations of that loop.
  const oldestIndexRef = useRef(0);
  oldestIndexRef.current = oldestIndex;
  // Set while prepending older rows; the layout effect below re-anchors the
  // viewport to the content the user was reading instead of jumping.
  const pendingScrollAnchorRef = useRef<{ prevHeight: number; prevTop: number; jumpCount: number } | null>(null);

  const resetPages = useCallback(() => {
    setHasMore(false);
    setOldestIndex(0);
    // The live cursor too: a jump could otherwise read the previous session's
    // window start before the state change has re-rendered.
    oldestIndexRef.current = 0;
    loadingOlderRef.current = false;
    setLoadingOlder(false);
    setLoadOlderError(false);
    // A recorded anchor belongs to the previous session's geometry, and its
    // request was dropped on the switch — applying it would write THAT window's
    // offset into this session's scrollTop.
    pendingScrollAnchorRef.current = null;
  }, []);

  const applyWindow = useCallback((hasMoreFromLoad: unknown, oldestIndexFromLoad: unknown) => {
    if (typeof hasMoreFromLoad === 'boolean') setHasMore(hasMoreFromLoad);
    if (typeof oldestIndexFromLoad === 'number') setOldestIndex(oldestIndexFromLoad);
  }, []);

  /** One older window ending just before `before`. `limit` of null leaves the
   *  server's default window size in place. */
  const fetchWindow = useCallback(async (before: number, limit: number | null): Promise<WindowPayload | null> => {
    if (!sessionId) return null;
    const suffix = limit === null ? '' : `&limit=${limit}`;
    const res = await fetch(`/api/chat/${sessionId}?before=${before}${suffix}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { session?: { messages?: ChatMessageData[] }; hasMore?: boolean; oldestIndex?: number };
    return { messages: data.session?.messages ?? [], hasMore: data.hasMore, oldestIndex: data.oldestIndex };
  }, [sessionId]);

  /** Record the viewport geometry an older-window prepend is about to shift,
   *  stamped with the bottom-jump count so the anchor can be dropped if the
   *  user asked for the tail after this request went out. */
  const anchorViewport = useCallback(() => {
    const el = scrollRef?.current;
    if (el) {
      pendingScrollAnchorRef.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop, jumpCount: jumpCountRef?.current ?? 0 };
    }
  }, [scrollRef, jumpCountRef]);

  /** Drop the jump's scroll-handler guard once its target scroll has settled.
   *  Until then the viewport is still near the top of history (where the paging
   *  trigger lives) and the smooth scroll is animating, so a stray "reached the
   *  top" read would page a window nobody asked for. */
  const releaseJumpGuard = useCallback(() => {
    const el = scrollRef?.current;
    if (!el) {
      railJumpActiveRef.current = false;
      return;
    }
    let lastTop = el.scrollTop;
    let settledFrames = 0;
    const watch = () => {
      if (el.scrollTop === lastTop) settledFrames += 1;
      else {
        settledFrames = 0;
        lastTop = el.scrollTop;
      }
      // A few still frames = the smooth scroll is done (or never started).
      if (settledFrames >= 5) {
        railJumpActiveRef.current = false;
        return;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }, [scrollRef]);

  /** Page the next older window into the timeline. Called from the click
   *  handler and the scroll handler when the viewport reaches the top; a no-op
   *  while a page is in flight, when the session has no more history, or while
   *  the session is a pending optimistic spawn. Prepending older rows only
   *  grows the list ABOVE the tail, so it is safe while the agent is
   *  generating — unlike a committed refetch, it never clobbers the AI
   *  placeholder, and blocking it made the button feel dead mid-run. */
  const loadOlder = useCallback(() => {
    if (!sessionId || sessionId.startsWith('new-')) return;
    if (!hasMore || loadingOlderRef.current || railJumpActiveRef.current) return;
    // A jump to the tail starts at the top, where this trigger lives: paging a
    // window then is work the jump never asked for, and the window's own
    // anchor would race the jump's landing.
    if (bottomJumpActiveRef?.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setLoadOlderError(false);
    anchorViewport();
    // Session id snapshot: prepending a window fetched for the PREVIOUS
    // session into the freshly-switched timeline is worse than dropping the
    // page, so the response is discarded if the user switched mid-flight.
    const requestedSessionId = sessionId;
    fetchWindow(oldestIndex, null)
      .then((page) => {
        // The main load effect may have cleared/repurposed localMessages for a
        // new session while this fetch was in flight.
        if (!page || sessionIdRef.current !== requestedSessionId) return;
        const older = page.messages;
        applyWindow(page.hasMore, page.oldestIndex);
        if (older.length === 0) {
          // No rows prepended: the recorded anchor is stale — drop it so a
          // later tick cannot apply it against the wrong geometry.
          pendingScrollAnchorRef.current = null;
          return;
        }
        setLocalMessages(prev => {
          // Drop overlap guard: the server window is index-based, so the
          // fetched slice is strictly older than everything already mounted.
          return [...older, ...prev];
        });
        // Bump the prepend tick so the layout effect below re-runs for THIS
        // commit — it previously depended only on stable identities and ran
        // exactly once at mount, so the viewport anchor never fired and every
        // pagination jump snapped the user to the (shifted) top.
        setPrependTick(t => t + 1);
      })
      .catch(() => {
        // Keep the button mounted and marked for retry; a swallowed failure
        // previously also cleared hasMore on the next full reload path.
        if (sessionIdRef.current === requestedSessionId) setLoadOlderError(true);
      })
      .finally(() => {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      });
  }, [sessionId, sessionIdRef, hasMore, oldestIndex, fetchWindow, anchorViewport, setLocalMessages, applyWindow, bottomJumpActiveRef]);

  /**
   * Walk the cursor down until the row with `id` is mounted, prepending every
   * window on the way so the timeline stays contiguous, then adopt the final
   * window metadata. Shares the in-flight flag with `loadOlder`, so the
   * scroll-triggered loader cannot interleave a second cursor walk.
   *
   * Resolves true when the row is mounted once the call returns — it already
   * was (a live row, or one inside the mounted window) or the walk brought it
   * in. The DOM commit for the last prepend may still be pending; the caller
   * owns waiting for the node.
   */
  const jumpToTurn = useCallback(async (id: string, index: number): Promise<boolean> => {
    if (!sessionId || sessionId.startsWith('new-')) return false;
    // `index < 0` is a live row (an optimistic send the committed history does
    // not carry yet); `index >= oldestIndex` is inside the mounted window.
    // Both are already on screen, so the jump needs no paging.
    if (index < 0 || index >= oldestIndexRef.current) return true;
    if (loadingOlderRef.current) return false;
    const requestedSessionId = sessionId;
    loadingOlderRef.current = true;
    railJumpActiveRef.current = true;
    setLoadingOlder(true);
    setLoadOlderError(false);
    // No viewport anchor here, deliberately: the anchor exists to hold the
    // user's reading position when history is paged in while they read, but a
    // jump is an explicit request for a DIFFERENT position. Anchoring would
    // write `scrollTop` on the prepend commit and abort the caller's smooth
    // scroll to the target mid-flight.

    let cursor = oldestIndexRef.current;
    let lastHasMore: unknown = hasMore;
    let reached = false;
    let requests = 0;
    try {
      while (!reached && cursor > index && requests < JUMP_MAX_REQUESTS) {
        requests += 1;
        // Stop exactly at the target: a window ending before `index` with
        // `cursor - index` rows has that turn as its oldest row.
        const page = await fetchWindow(cursor, Math.min(JUMP_CHUNK_MESSAGES, cursor - index));
        // The user switched sessions mid-walk: prepending this window would
        // inject another session's rows into the fresh timeline.
        if (!page || sessionIdRef.current !== requestedSessionId) return false;
        const older = page.messages;
        if (older.length === 0) break;
        const next = typeof page.oldestIndex === 'number' ? page.oldestIndex : Math.max(0, cursor - older.length);
        setLocalMessages(prev => [...older, ...prev]);
        reached = older.some((message) => message.id === id);
        // A cursor that did not advance would re-serve the same slice forever.
        if (next >= cursor) break;
        cursor = next;
        lastHasMore = page.hasMore;
      }
    } catch {
      if (sessionIdRef.current === requestedSessionId) setLoadOlderError(true);
      return false;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
    applyWindow(lastHasMore, cursor);
    // Bump the prepend tick so the viewport-anchor effect re-runs for the rows
    // this walk prepended (same contract as loadOlder).
    if (requests > 0) setPrependTick(t => t + 1);
    releaseJumpGuard();
    return reached;
  }, [sessionId, sessionIdRef, hasMore, fetchWindow, setLocalMessages, applyWindow, releaseJumpGuard]);

  // Position preservation: after older rows commit above the viewport, shift
  // scrollTop by the height delta so the rows the user was reading stay put.
  // prependTick changes on every prepend — without it the effect ran only at
  // mount (its other deps are stable) and never re-anchored.
  useLayoutEffect(() => {
    const anchor = pendingScrollAnchorRef.current;
    if (!anchor) return;
    const el = scrollRef?.current;
    if (!el) return;
    pendingScrollAnchorRef.current = null;
    // The user asked for the tail after this window was requested: holding the
    // old reading position would write scrollTop straight over that jump (a
    // window landing mid-jump parked the viewport ~26k px short of the tail).
    // The jump's own landing, plus the scroll hook's re-pin, owns the position.
    if (anchor.jumpCount !== (jumpCountRef?.current ?? 0)) return;
    const delta = el.scrollHeight - anchor.prevHeight;
    if (delta > 0) el.scrollTop = anchor.prevTop + delta;
  }, [prependTick, scrollRef]);

  return { hasMore, loadingOlder, loadOlderError, loadOlder, jumpToTurn, resetPages, applyWindow };
}
