/**
 * @license
 * SPDX-License-Identifier: MIT
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

import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from 'preact/hooks';
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

/**
 * The cancel hook of every restore currently armed, by scroller.
 *
 * A pending restore REPLAYS while the document settles, and it re-applies
 * through a `ResizeObserver` — which can fire BEFORE the scroll event a
 * programmatic reveal causes. Measured: an outline jump scrolled a 2 520-line
 * file to 34 695 px and the observer wrote the stored 0 back 375 ms later, so
 * the caret moved and the view stayed at the top.
 *
 * An explicit reveal therefore has to CANCEL the restore rather than race it,
 * and the surface that scrolls is the one that knows. This registry is that
 * hand-off: keyed by the element, so a caller needs no reference to the hook
 * instance that armed it (the surface owns the scroller; the panel owns the
 * hook).
 */
const armedRestores = new Map<HTMLElement, () => void>();

/** Stop a pending restore of `element` — a reveal wins over a remembered offset. */
export function cancelScrollRestore(element: HTMLElement | null): void {
  if (!element) return;
  armedRestores.get(element)?.();
}

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
  /**
   * The element to restore, for a caller that does not own a `ref` on it.
   *
   * The code surface's scroller belongs to CodeMirror (`view.scrollDOM`) and
   * exists only after the view mounts, so the surface reports it through
   * `onScroller` and the caller passes it here. `undefined` means "this caller
   * uses `ref`"; `null` means "the element is not there yet", which re-arms the
   * restore on the next render that has one.
   */
  element?: HTMLElement | null;
}

export function useScrollRestore({
  tabKey,
  surface,
  ready = true,
  slot = SCROLL_POSITIONS_KEY,
  element: providedElement,
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
  /**
   * What the element's `scrollTop` was at the last observation, so a scroll
   * event that moves it WITHOUT anyone assigning can be recognised as the
   * browser's own anchoring rather than the reader's.
   *
   * This is the bug the e2e spec found on CI and could not explain: returning to
   * a long file landed the reader on line 99 instead of line 70, and the wrong
   * offset was then persisted. Measured in the browser: the restore wrote 1255,
   * the document's real height arrived a frame later (5796 → 7232), and
   * CodeMirror re-anchored — `scrollTop` became 1777 with no assignment from
   * this hook. That produced a `scroll` event, the handler below compared it
   * against `restoredTopRef` (1255), read a 522px delta, and treated it as the
   * reader's own scroll: the pending restore was dropped, and the anchored
   * value became what got stored. The reader moved 29 lines for opening a tab.
   *
   * An anchoring correction is not a reader. It is re-applied like any other
   * height change, because the target offset is the one the session recorded.
   */
  const observedTopRef = useRef(0);
  /**
   * Whether the reader has DONE something since the last scroll event — the
   * only thing that separates their scroll from the browser's own.
   *
   * Every way a reader scrolls a code surface starts with an input event: a
   * wheel, a key (arrows, PageDown, Home/End), a pointer press on the scrollbar
   * or a drag-select, a touch. CodeMirror re-anchoring starts with none, so a
   * `scroll` with no input behind it is the document settling. The flag is
   * cleared by the scroll it explains, so the next unattributed move is read as
   * anchoring again.
   */
  const readerIntentRef = useRef(false);
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
    if (Math.abs(element.scrollTop - pending.top) < NOISE_PX) {
      observedTopRef.current = element.scrollTop;
      return;
    }
    writingRef.current = true;
    element.scrollTop = pending.top;
    writingRef.current = false;
    // Read back: the document may be shorter than the target, and the clamped
    // value is what an asynchronous scroll event will report.
    restoredTopRef.current = element.scrollTop;
    observedTopRef.current = element.scrollTop;
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
      // Moved with nobody assigning AND no reader input behind it: CodeMirror
      // re-anchoring after the document's real height landed. NOT the reader —
      // re-applying the recorded offset is what keeps them where they were. See
      // `observedTopRef` for the measurement.
      const moved = Math.abs(top - observedTopRef.current) >= NOISE_PX;
      observedTopRef.current = top;
      if (moved && !readerIntentRef.current) {
        applyPending();
        return;
      }
      if (Math.abs(top - restoredTopRef.current) < NOISE_PX * 2) return;
      pendingRef.current = null;
    }
    observedTopRef.current = top;
    // The input this scroll belongs to has now been accounted for; the next
    // unattributed move is anchoring again.
    readerIntentRef.current = false;
    lastTopRef.current = top;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = undefined;
      const value = lastTopRef.current;
      if (value !== null) persist(value);
    }, SAVE_DEBOUNCE_MS);
  }, [applyPending, persist, tabKey]);

  // A provided element is not a React-rendered node, so its scroll events have
  // to be wired here: the caller has no `onScroll` prop to hang them on. The
  // ref path keeps the caller's own `onScroll`.
  useEffect(() => {
    if (!providedElement) return;
    const listener = () => onScroll();
    providedElement.addEventListener('scroll', listener, { passive: true });
    return () => providedElement.removeEventListener('scroll', listener);
  }, [providedElement, onScroll]);

  // What counts as the reader having scrolled, for `readerIntentRef`. Wired on
  // the element AND the window, because a keydown goes to the focused editor
  // while a wheel over the gutter goes to the window's capture phase.
  useEffect(() => {
    const element = providedElement ?? elementRef.current;
    if (!element) return;
    const note = () => {
      readerIntentRef.current = true;
    };
    const types = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;
    for (const type of types) element.addEventListener(type, note, { passive: true });
    window.addEventListener('keydown', note, { passive: true });
    return () => {
      for (const type of types) element.removeEventListener(type, note);
      window.removeEventListener('keydown', note);
    };
  }, [providedElement]);

  // A layout effect so the restore lands in the same frame the tab paints — a
  // passive effect would show the document's head for one frame first.
  useLayoutEffect(() => {
    pendingRef.current = null;
    lastTopRef.current = null;
    readerIntentRef.current = false;
    let observer: ResizeObserver | null = null;
    // A provided element WINS over the ref: the caller handed us the element it
    // wants restored, and a stale ref from the other surface of the same tab
    // must not be restored instead.
    if (providedElement !== undefined) elementRef.current = providedElement;
    const element = elementRef.current;

    if (ready && storeReady && tabKey && element) {
      // Armed even when nothing is stored: the container is SHARED across tabs,
      // so it still carries the previous document's offset — switching from a
      // long file to a fresh one would otherwise land the reader in the middle
      // of it. "No stored offset" means the top, and the top is where they go.
      const top = readScrollTop(getSessionValue<ScrollPositions>(sessionId, slot), tabKey, surface);
      pendingRef.current = { top, until: performance.now() + RESTORE_WINDOW_MS };
      armedRestores.set(element, () => {
        pendingRef.current = null;
      });
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
      if (element) armedRestores.delete(element);
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
  }, [ready, storeReady, tabKey, surface, sessionId, slot, applyPending, persist, providedElement]);

  return { ref: attach, onScroll };
}
