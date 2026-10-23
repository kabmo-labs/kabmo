/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Long press, for the surfaces that have no right-click.
 *
 * A phone's Files panel offered no way to reach a row's context menu: the menu
 * opens on `contextmenu`, which a touch device only raises after a press that
 * the browser has already claimed for something else — a native drag (the row
 * is a drag source) or a text selection of the whole panel. Measured on a
 * phone: holding a file row selected the tree's text and started a drag ghost,
 * and no menu ever appeared.
 *
 * Three rules make this usable rather than a second way to break the panel:
 *
 * - **A press that MOVES is a scroll, not a press.** The tree is a scroller, and
 *   a hold that begins a scroll must cancel — otherwise every flick that starts
 *   on a row opens a menu. The threshold is small (`SLOP_PX`) because the first
 *   few pixels of a scroll arrive within the same tick.
 * - **A fired press suppresses the CLICK it would otherwise produce.** Lifting
 *   the finger after the menu opened would otherwise also toggle the folder the
 *   menu was opened for. The caller asks `consume()` from its click handler,
 *   which is the only place the two can be told apart — the platform raises both
 *   events for one gesture and does not mark either.
 * - **It is inert without a touch device.** A mouse already has a right button,
 *   and a desktop holding its primary button down over a row is a drag.
 *
 * The handler is deliberately not `onContextMenu`-based: some Android builds DO
 * raise `contextmenu` after a hold, and the browser's own press has already
 * started a selection by then, so the menu would open over a half-selected tree.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';

/** How long a press must be held before it counts. */
const LONG_PRESS_MS = 450;
/** Movement that turns a press into a scroll, in CSS pixels. */
const SLOP_PX = 8;
/** How long a fired press keeps suppressing the click it produces. */
const CLICK_SUPPRESS_MS = 700;

export interface LongPressOptions {
  /** False on a device with a pointer: the right button already does this. */
  enabled: boolean;
  /** Where the press landed, in viewport coordinates — a menu anchor. */
  onLongPress: (x: number, y: number) => void;
}

export interface LongPressHandlers {
  onTouchStart: (event: globalThis.TouchEvent) => void;
  onTouchMove: (event: globalThis.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  /**
   * True exactly once after a press fired, so the caller's click handler can
   * ignore the click the same gesture produces.
   */
  consume: () => boolean;
}

export function useLongPress({ enabled, onLongPress }: LongPressOptions): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const firedAtRef = useRef(0);
  /** The latest callback, so a re-render never leaves a stale one armed. */
  const handlerRef = useRef(onLongPress);
  handlerRef.current = onLongPress;

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onTouchStart: (event) => {
      if (!enabled) return;
      const touch = event.touches[0];
      if (!touch) return;
      cancel();
      originRef.current = { x: touch.clientX, y: touch.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const origin = originRef.current;
        originRef.current = null;
        if (!origin) return;
        firedAtRef.current = Date.now();
        handlerRef.current(origin.x, origin.y);
      }, LONG_PRESS_MS);
    },
    onTouchMove: (event) => {
      const origin = originRef.current;
      const touch = event.touches[0];
      if (!origin || !touch) return;
      if (Math.abs(touch.clientX - origin.x) > SLOP_PX || Math.abs(touch.clientY - origin.y) > SLOP_PX) cancel();
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    consume: () => {
      if (firedAtRef.current === 0) return false;
      const recent = Date.now() - firedAtRef.current < CLICK_SUPPRESS_MS;
      firedAtRef.current = 0;
      return recent;
    },
  };
}
