/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rail jump's cursor walk: page contiguous windows from the head of history
 * until the clicked turn's row is mounted.
 *
 * A window fetched straight to the target would leave a HOLE in the timeline —
 * the loader is index-based and the client prepends — so the walk steps the
 * cursor down one bounded chunk at a time, adopting each window's metadata as
 * it lands. Split out of `session-pagination.ts` because it is the one part of
 * paging that runs as a multi-request loop rather than a single prepend, and
 * because that file is at its own size ceiling.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import type { ChatMessageData } from '@/shared/types';

/** Messages one jump request may pull. Larger than the default page so a jump
 *  is a few round trips instead of dozens, small enough that no single payload
 *  mounts an unbounded slice of the session. */
const JUMP_CHUNK_MESSAGES = 300;

/** Ceiling on jump requests: a cursor that refuses to advance (a server window
 *  that keeps re-serving the same slice) must end the walk, not spin. */
const JUMP_MAX_REQUESTS = 40;

/** How long a jump waits for a window another path is already paging in.
 *  A rail click usually arrives while the reader is scrolling the head of
 *  history, i.e. exactly when the scroll trigger has a request in flight —
 *  refusing then made the click do nothing at all, which reads as a dead rail. */
const PAGE_WAIT_MS = 10_000;

export interface JumpWindowPayload {
  messages: ChatMessageData[];
  hasMore?: boolean;
  oldestIndex?: number;
}

export interface WalkToTurnDeps {
  /** The turn's row id (the DOM target). */
  id: string;
  /** Its position in the FULL message list. */
  index: number;
  /** Session the click belongs to; the walk aborts if it changes. */
  sessionId: string;
  sessionIdRef: { current: string | null };
  /** Live cursor — state does not update between loop iterations. */
  oldestIndexRef: { current: number };
  /** Shared with `loadOlder`, so a scroll-triggered page cannot interleave. */
  loadingOlderRef: { current: boolean };
  /** Server window ending just before a cursor position. */
  fetchWindow: (before: number, limit: number | null) => Promise<JumpWindowPayload | null>;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  /** Adopt the final window's metadata. */
  applyWindow: (hasMore: unknown, oldestIndex: unknown) => void;
  /** Report a failed request through the retryable affordance. */
  setLoadOlderError: (value: boolean) => void;
  setLoadingOlder: (value: boolean) => void;
  /** Release the scroll-handler guard once the landing has settled. */
  releaseJumpGuard: () => void;
  /** Signal the viewport-anchor effect that rows were prepended. */
  bumpPrependTick: () => void;
}

/**
 * Resolves true when the row is mounted once the call returns — it already was
 * (a live row, or one inside the mounted window) or the walk brought it in. The
 * DOM commit for the last prepend may still be pending; the caller owns waiting
 * for the node.
 */
export async function walkToTurn(deps: WalkToTurnDeps): Promise<boolean> {
  const {
    id, index, sessionId, sessionIdRef, oldestIndexRef, loadingOlderRef,
    fetchWindow, setLocalMessages, applyWindow, setLoadOlderError, setLoadingOlder,
    releaseJumpGuard, bumpPrependTick,
  } = deps;

  // `index < 0` is a live row (an optimistic send the committed history does
  // not carry yet); `index >= oldestIndex` is inside the mounted window. Both
  // are already on screen, so the jump needs no paging.
  if (index < 0 || index >= oldestIndexRef.current) return true;
  // A window is in flight (the scroll trigger, or an earlier jump): wait for it
  // rather than dropping the click. Two cursor walks interleaved would prepend
  // overlapping slices; one after the other cannot.
  if (loadingOlderRef.current) {
    const until = Date.now() + PAGE_WAIT_MS;
    while (loadingOlderRef.current && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (loadingOlderRef.current) return false;
    // The window that just landed may already carry the target.
    if (index < 0 || index >= oldestIndexRef.current) return true;
  }

  loadingOlderRef.current = true;
  setLoadingOlder(true);
  setLoadOlderError(false);
  // No viewport anchor here, deliberately: the anchor exists to hold the user's
  // reading position when history is paged in while they read, but a jump is an
  // explicit request for a DIFFERENT position. Anchoring would write
  // `scrollTop` on the prepend commit and abort the landing mid-flight.

  let cursor = oldestIndexRef.current;
  let lastHasMore: unknown = undefined;
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
      if (!page || sessionIdRef.current !== sessionId) return false;
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
    if (sessionIdRef.current === sessionId) setLoadOlderError(true);
    return false;
  } finally {
    loadingOlderRef.current = false;
    setLoadingOlder(false);
  }
  applyWindow(lastHasMore, cursor);
  // Bump the prepend tick so the viewport-anchor effect re-runs for the rows
  // this walk prepended (same contract as `loadOlder`).
  if (requests > 0) bumpPrependTick();
  releaseJumpGuard();
  return reached;
}
