/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The viewport a write must leave behind.
 *
 * ghostty-web's `writeInternal` ends with `viewportY !== 0 && scrollToBottom()`,
 * so every PTY chunk re-anchors the view to the live end. Measured on the
 * assembled panel before this module existed: a wheel-up during a `tail -F`
 * stream was undone by the next chunk (the "Latest" button never appeared), and
 * a two-row drag during a 100 lines/s stream copied twelve lines because the
 * content moved between the press and the release.
 */

import { describe, expect, test } from 'bun:test';
import {
  heldTop,
  holdAcrossWrite,
  viewportYForTop,
  watchPointerPress,
  type HoldableViewport,
} from '@/client/components/workspace/terminal-panel/scroll-hold';
import { pristineDomGlobals } from '@/test-support/pristine-globals';

/**
 * The runner's own `Event`/`EventTarget`, as a PAIR.
 *
 * This file dispatches synthetic events at a target it creates itself, so both
 * have to come from one realm. Reading the globals at call time made the suite
 * fail before it asserted anything whenever an earlier file had left a
 * happy-dom window installed: `new Event(…)` was happy-dom's constructor and
 * `new EventTarget()` the runner's, and `dispatchEvent` refused the event. The
 * captured values are the runner's own (see `pristine-globals.ts`), with the
 * live globals as the fallback for a run where no suite installed a window yet.
 */
const EventCtor = (pristineDomGlobals.Event ?? globalThis.Event) as typeof Event;
const EventTargetCtor = (pristineDomGlobals.EventTarget ?? globalThis.EventTarget) as typeof EventTarget;

/** A viewport whose scrollback grows by `appended` lines on every write. */
function fakeViewport(options: { scrollback: number; viewportY: number; appended: number; hasSelection?: boolean }) {
  const state = {
    scrollback: options.scrollback,
    viewportY: options.viewportY,
    hasSelection: options.hasSelection ?? false,
    scrollCalls: [] as number[],
  };
  const viewport: HoldableViewport = {
    getScrollbackLength: () => state.scrollback,
    getViewportY: () => state.viewportY,
    hasSelection: () => state.hasSelection,
    scrollLines: (amount) => {
      state.scrollCalls.push(amount);
      state.viewportY = Math.max(0, Math.min(state.scrollback, state.viewportY - amount));
    },
  };
  const write = () => {
    state.scrollback += options.appended;
    // The library's own snap, which the hold has to undo.
    state.viewportY = 0;
  };
  return { viewport, state, write };
}

describe('heldTop', () => {
  test('follows output when the reader is at the bottom with nothing selected', () => {
    expect(heldTop({ scrollback: 500, viewportY: 0, hasSelection: false, pointerHeld: false })).toBeNull();
  });

  test('holds the absolute row the reader scrolled to', () => {
    expect(heldTop({ scrollback: 500, viewportY: 120, hasSelection: false, pointerHeld: false })).toBe(380);
  });

  test('holds while a selection exists, even at the bottom', () => {
    expect(heldTop({ scrollback: 500, viewportY: 0, hasSelection: true, pointerHeld: false })).toBe(500);
  });

  test('holds from the press, before the engine has a selection', () => {
    expect(heldTop({ scrollback: 500, viewportY: 0, hasSelection: false, pointerHeld: true })).toBe(500);
  });
});

describe('viewportYForTop', () => {
  test('turns the held row back into a distance from the bottom', () => {
    expect(viewportYForTop({ scrollback: 620, top: 380 })).toBe(240);
  });

  test('reports the bottom as null, so no scroll is issued', () => {
    expect(viewportYForTop({ scrollback: 500, top: 500 })).toBeNull();
  });
});

describe('holdAcrossWrite', () => {
  test('keeps the same content on screen as a stream appends lines', () => {
    const { viewport, state, write } = fakeViewport({ scrollback: 500, viewportY: 120, appended: 3 });
    holdAcrossWrite(viewport, { pointerHeld: false }, write);
    // The top row (380) is still the top row: 503 - 380 = 123, and the snap to
    // zero is undone in one scroll call.
    expect(state.viewportY).toBe(123);
    expect(state.scrollCalls).toEqual([-123]);
  });

  test('lets ordinary output scroll when nothing holds the view', () => {
    const { viewport, state, write } = fakeViewport({ scrollback: 500, viewportY: 0, appended: 3 });
    holdAcrossWrite(viewport, { pointerHeld: false }, write);
    expect(state.viewportY).toBe(0);
    expect(state.scrollCalls).toEqual([]);
  });

  test('holds a selection at the bottom, so a copy is not scrolled away', () => {
    const { viewport, state, write } = fakeViewport({ scrollback: 500, viewportY: 0, appended: 2, hasSelection: true });
    holdAcrossWrite(viewport, { pointerHeld: false }, write);
    expect(state.viewportY).toBe(2);
  });

  test('holds from the press, before the drag threshold is met', () => {
    const { viewport, state, write } = fakeViewport({ scrollback: 500, viewportY: 0, appended: 4 });
    holdAcrossWrite(viewport, { pointerHeld: true }, write);
    expect(state.viewportY).toBe(4);
  });

  test('a released press with no selection follows output again', () => {
    const { viewport, state, write } = fakeViewport({ scrollback: 500, viewportY: 0, appended: 4 });
    holdAcrossWrite(viewport, { pointerHeld: false }, write);
    expect(state.viewportY).toBe(0);
  });

  test('a disposed terminal does not throw out of the write path', () => {
    const viewport: HoldableViewport = {
      getScrollbackLength: () => 500,
      getViewportY: () => 120,
      hasSelection: () => false,
      scrollLines: () => {
        throw new Error('Terminal not open');
      },
    };
    expect(() => holdAcrossWrite(viewport, { pointerHeld: false }, () => {})).not.toThrow();
  });
});

describe('watchPointerPress', () => {
  /** A container that is an event target but not a DOM element — all the watcher touches. */
  const container = () => new EventTargetCtor() as unknown as HTMLElement;

  test('holds from the press and lets go on release', () => {
    const element = container();
    const watch = watchPointerPress(element);
    expect(watch.pointerHeld).toBe(false);
    element.dispatchEvent(new EventCtor('pointerdown'));
    expect(watch.pointerHeld).toBe(true);
    globalThis.dispatchEvent(new EventCtor('pointerup'));
    expect(watch.pointerHeld).toBe(false);
    watch.stop();
  });

  test('a cancelled gesture ends the hold, not a stuck viewport', () => {
    const element = container();
    const watch = watchPointerPress(element);
    element.dispatchEvent(new EventCtor('pointerdown'));
    globalThis.dispatchEvent(new EventCtor('pointercancel'));
    expect(watch.pointerHeld).toBe(false);
    watch.stop();
  });

  test('stop() detaches, so a disposed mount cannot hold a later one', () => {
    const element = container();
    const watch = watchPointerPress(element);
    watch.stop();
    element.dispatchEvent(new Event('pointerdown'));
    expect(watch.pointerHeld).toBe(false);
  });
});
