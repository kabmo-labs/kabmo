/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Put a tab back where the reader left it.
 *
 * The editor column keeps ONE scroll container per surface and swaps the
 * document inside it on a tab switch, so the browser clamps the shared scroller
 * to the height of whatever is in it now — returning to a long file landed at
 * line 1 and the reader had to find their place again. The offset is remembered
 * per tab (and per surface, see `ScrollSurface`) in the session's UI state, so
 * it survives a tab switch AND a reload.
 *
 * Three things make this more than a `scrollTop = saved`:
 *
 * - **The restore REPLAYS while the document settles.** A file's height is not
 *   final on the commit that opens it: the line geometry is measured in a
 *   layout effect, the editor panel animates its width, and a long file's
 *   windowed spacers grow as the measurement lands. An offset applied once is
 *   clamped to whatever height existed at that instant, so it is re-applied for
 *   a short window — the same tradeoff `CodeSurface.revealOffset` documents for
 *   a find jump.
 * - **A reader's own scroll WINS over a pending restore.** Reaching for the
 *   wheel mid-restore says the remembered position is wrong, and fighting the
 *   user for the rest of the window is worse than a missed restore.
 * - **Only a reader's own scrolls are recorded.** The offset written on the way
 *   out comes from the last scroll EVENT, never from reading the element: a
 *   layout effect's cleanup runs AFTER the DOM already shows the next tab, so
 *   `element.scrollTop` there is the NEXT file's offset — recording it would
 *   overwrite the position this hook exists to keep.
 */

import { useCallback, useContext, useLayoutEffect, useRef } from 'preact/hooks';
import { SessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { getSessionValue, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import {
  SCROLL_POSITIONS_KEY,
  readScrollTop,
  writeScrollTop,
  type ScrollPositions,
  type ScrollSurface,
} from '@/shared/lib/workspace/scroll-positions';

/** How long a restore keeps re-applying while the document settles. */
const RESTORE_WINDOW_MS = 600;

/** How long the scrolling must be quiet before the offset is persisted. */
const SAVE_DEBOUNCE_MS = 150;

/** Scroll deltas below this are rounding, not a move. */
const NOISE_PX = 1;

/** What a caller attaches to its scroll container. */
export interface ScrollRestoreBinding {
  ref: (element: HTMLElement | null) => void;
  onScroll: () => void;
}

export interface UseScrollRestoreOptions {
  /** The tab this container shows; null (no tab) remembers nothing. */
  tabKey: string | null;
  /** Which surface of that tab is on screen — its own offset. */
  surface: ScrollSurface;
  /** The document is on screen; false while the pane still shows a spinner. */
  ready?: boolean;
  /** The session-state slot to read/write; the editor column's by default. */
  slot?: string;
}

export function useScrollRestore({
  tabKey,
  surface,
  ready = true,
  slot = SCROLL_POSITIONS_KEY,
}: UseScrollRestoreOptions): ScrollRestoreBinding {
  // Read OPTIONALLY: the shared diff views also draw a chat tool card, and a
  // caller may mount one without the provider. A null context makes the whole
  // hook inert — `getSessionValue`/`setSessionKey` take a null session and do
  // nothing — rather than throwing from a component that has nothing to
  // remember in the first place.
  const context = useContext(SessionStateContext);
  const sessionId = context?.sessionId ?? null;
  const storeReady = context?.ready ?? false;
  const elementRef = useRef<HTMLElement | null>(null);
  /** The offset a restore is aiming at, and when to stop re-applying it. */
  const pendingRef = useRef<{ top: number; until: number } | null>(null);
  /** What the last restore write landed on, so its own scroll event is not the reader's. */
  const restoredTopRef = useRef(0);
  /**
   * True for the duration of a restore's own write.
   *
   * Load-bearing, and not the same test as `restoredTopRef`: a scroll event can
   * be delivered SYNCHRONOUSLY from the `scrollTop` assignment (measured in
   * happy-dom, and a browser may deliver it before the next frame), and at that
   * instant the read-back below has not run yet — so the guard compared the
   * event against the PREVIOUS value, read a large delta, and treated our own
   * clamped write as the reader's, dropping the pending restore. A document
   * whose height is still growing then stayed where the clamp left it.
   */
  const writingRef = useRef(false);
  /** The last offset the READER produced, persisted on the way out. */
  const lastTopRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  /** Re-apply a pending restore against the element's CURRENT height. */
  const applyPending = useCallback(() => {
    const pending = pendingRef.current;
    const element = elementRef.current;
    if (!pending || !element) return;
    if (performance.now() > pending.until) {
      pendingRef.current = null;
      return;
    }
    if (Math.abs(element.scrollTop - pending.top) < NOISE_PX) return;
    writingRef.current = true;
    element.scrollTop = pending.top;
    writingRef.current = false;
    // Read back: the document may be shorter than the target, and the clamped
    // value is what an asynchronous scroll event will report.
    restoredTopRef.current = element.scrollTop;
  }, []);

  const attach = useCallback(
    (element: HTMLElement | null) => {
      elementRef.current = element;
      if (element) applyPending();
    },
    [applyPending],
  );

  const persist = useCallback(
    (top: number) => {
      if (!tabKey) return;
      const current = getSessionValue<ScrollPositions>(sessionId, slot);
      // Compared against the STORED offset, not the map's identity: a scroll
      // that ends where it started must cost no write — every write notifies
      // every follower of the slot.
      if ((current?.[tabKey]?.[surface] ?? 0) === top) return;
      setSessionKey(sessionId, slot, writeScrollTop(current, tabKey, surface, top));
    },
    [sessionId, slot, tabKey, surface],
  );

  const onScroll = useCallback(() => {
    const element = elementRef.current;
    if (!element || !tabKey) return;
    const top = element.scrollTop;
    if (pendingRef.current) {
      // Our own write, not the reader: leave the restore in charge. Two tests,
      // because the event may arrive synchronously (during the assignment) or
      // on a later frame (against the value the write landed on).
      if (writingRef.current) return;
      if (Math.abs(top - restoredTopRef.current) < NOISE_PX * 2) return;
      pendingRef.current = null;
    }
    lastTopRef.current = top;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = undefined;
      const value = lastTopRef.current;
      if (value !== null) persist(value);
    }, SAVE_DEBOUNCE_MS);
  }, [persist, tabKey]);

  // A layout effect so the restore lands in the same frame the tab paints — a
  // passive effect would show the document's head for one frame first.
  useLayoutEffect(() => {
    pendingRef.current = null;
    lastTopRef.current = null;
    let observer: ResizeObserver | null = null;
    const element = elementRef.current;

    if (ready && storeReady && tabKey && element) {
      // Armed even when nothing is stored: the container is SHARED across tabs,
      // so it still carries the previous document's offset — switching from a
      // long file to a fresh one would otherwise land the reader in the middle
      // of it. "No stored offset" means the top, and the top is where they go.
      const top = readScrollTop(getSessionValue<ScrollPositions>(sessionId, slot), tabKey, surface);
      pendingRef.current = { top, until: performance.now() + RESTORE_WINDOW_MS };
      applyPending();
      // The document's own height is what moves after this commit (measurement,
      // a width animation, spacers landing), so its growth is what re-applies.
      const content = element.firstElementChild;
      if (content && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => applyPending());
        observer.observe(content);
      }
    }

    return () => {
      observer?.disconnect();
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
      // Deliberately NOT `element.scrollTop`: by the time this cleanup runs the
      // DOM already holds the next tab's document, so reading the element here
      // would store the NEW file's offset under the OLD tab's key. Only what the
      // reader scrolled is ours to write.
      const top = lastTopRef.current;
      lastTopRef.current = null;
      if (top !== null) persist(top);
    };
    // `applyPending`/`persist` are stable, and re-running this effect restarts
    // the restore — which is exactly what a tab or surface change needs.
  }, [ready, storeReady, tabKey, surface, sessionId, slot, applyPending, persist]);

  return { ref: attach, onScroll };
}
