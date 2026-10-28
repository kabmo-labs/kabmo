/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wheel-zoom arithmetic and its one exclusion.
 *
 * Both are silent failures if wrong: a threshold-based step makes a trackpad pinch
 * zoom several sizes per gesture, and a missing nested-scroller check resizes the
 * code while the user is scrolling a list of search hits.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { clampZoom, isInsideNestedScroller, zoomStepsFromWheel } from '@/client/hooks/editor/wheel-zoom';
import { EDITOR_MAX_FONT_SIZE, EDITOR_MIN_FONT_SIZE } from '@/shared/lib/code/editor/typography';

describe('zoomStepsFromWheel', () => {
  test('a wheel up zooms in and a wheel down zooms out', () => {
    expect(zoomStepsFromWheel(-100)).toBe(1);
    expect(zoomStepsFromWheel(100)).toBe(-1);
  });

  test('a trackpad pinch of ±1 is still exactly one step', () => {
    // A magnitude threshold would treat these as noise and zoom nothing, which is the
    // reported "pinch does nothing" failure.
    expect(zoomStepsFromWheel(-1)).toBe(1);
    expect(zoomStepsFromWheel(1)).toBe(-1);
  });

  test('a fast fling is capped at one step, so one gesture cannot jump several sizes', () => {
    expect(zoomStepsFromWheel(-1000)).toBe(1);
    expect(zoomStepsFromWheel(1000)).toBe(-1);
  });

  test('no delta is no step', () => {
    expect(zoomStepsFromWheel(0)).toBe(0);
  });
});

describe('clampZoom', () => {
  test('clamps to the SHARED bounds the toolbar uses', () => {
    expect(clampZoom(EDITOR_MAX_FONT_SIZE, 1)).toBe(EDITOR_MAX_FONT_SIZE);
    expect(clampZoom(EDITOR_MIN_FONT_SIZE, -1)).toBe(EDITOR_MIN_FONT_SIZE);
  });

  test('a step inside the bounds moves by exactly one', () => {
    expect(clampZoom(12, 1)).toBe(13);
    expect(clampZoom(12, -1)).toBe(11);
  });

  test('a caller may pass its own bounds', () => {
    expect(clampZoom(5, 1, 0, 6)).toBe(6);
    expect(clampZoom(5, 1, 0, 5)).toBe(5);
  });
});

describe('isInsideNestedScroller', () => {
  // The helper reads `HTMLElement` and `getComputedStyle` from the global scope, which
  // is how it runs in the browser — so the DOM globals are installed for this block.
  const win = new Window({ url: 'http://localhost' });
  const GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'getComputedStyle'] as const;
  const native: Partial<Record<(typeof GLOBALS)[number], unknown>> = {};


  beforeAll(() => {
    const target = globalThis as unknown as Record<string, unknown>;
    const source = win as unknown as Record<string, unknown>;
    for (const key of GLOBALS) {
      native[key] = target[key];
      target[key] = source[key];
    }
  });

  afterAll(() => {
    const target = globalThis as unknown as Record<string, unknown>;
    for (const key of GLOBALS) target[key] = native[key];
  });

  /**
   * Attach the tree before asking.
   *
   * `getComputedStyle` resolves the cascade, which needs the node in a document —
   * measured in happy-dom: a detached `overflow-y: auto` element computes to an empty
   * string. A real editor's nodes are always attached, so this is the fixture being
   * honest rather than a workaround for the helper.
   */
  function attach(host: HTMLElement): void {
    // happy-dom's own `Node`/`HTMLElement` classes are structurally different from the
    // DOM lib's, so the handover is a cast at the fixture boundary — the runtime objects
    // are the ones the helper will see.
    win.document.body.appendChild(host as unknown as Parameters<typeof win.document.body.appendChild>[0]);
  }

  test('a scrolling ancestor between the target and the host owns the wheel', () => {
    const host = win.document.createElement('div');
    const scroller = win.document.createElement('div');
    const inner = win.document.createElement('span');
    host.appendChild(scroller);
    scroller.appendChild(inner);
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 400 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 });
    scroller.style.overflowY = 'auto';
    attach(host as unknown as HTMLElement);
    expect(isInsideNestedScroller(inner as unknown as EventTarget, host as unknown as HTMLElement)).toBe(true);
  });

  test('a plain ancestor does not', () => {
    const host = win.document.createElement('div');
    const plain = win.document.createElement('div');
    const inner = win.document.createElement('span');
    host.appendChild(plain);
    plain.appendChild(inner);
    attach(host as unknown as HTMLElement);
    expect(isInsideNestedScroller(inner as unknown as EventTarget, host as unknown as HTMLElement)).toBe(false);
  });

  test('a scroller that cannot actually scroll does not claim the wheel', () => {
    // `overflow-y: auto` on a box whose content fits is not a scroll container in any
    // sense the user can feel, so it must not swallow the zoom.
    const host = win.document.createElement('div');
    const box = win.document.createElement('div');
    const inner = win.document.createElement('span');
    host.appendChild(box);
    box.appendChild(inner);
    box.style.overflowY = 'auto';
    Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 100 });
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 100 });
    attach(host as unknown as HTMLElement);
    expect(isInsideNestedScroller(inner as unknown as EventTarget, host as unknown as HTMLElement)).toBe(false);
  });

  test('the host itself is not nested, and a null target is not either', () => {
    const host = win.document.createElement('div');
    attach(host as unknown as HTMLElement);
    expect(isInsideNestedScroller(host as unknown as EventTarget, host as unknown as HTMLElement)).toBe(false);
    expect(isInsideNestedScroller(null, host as unknown as HTMLElement)).toBe(false);
  });
});
