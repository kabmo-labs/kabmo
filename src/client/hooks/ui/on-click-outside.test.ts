/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useOnClickOutside` must be able to stand DOWN, not just decline to act.
 *
 * The model picker's phone placement portals its overlay to `<body>`, so the
 * overlay is outside the picker's `containerRef` by construction: an armed
 * listener sees the press that was meant to choose a model as an outside press
 * and closes the picker on `mousedown` — before `click` reaches the row. That is
 * the measured "tap a model on a phone and nothing happens".
 *
 * Both directions are pinned here because the flag has to keep working for the
 * nineteen other call sites: armed closes on an outside press and ignores an
 * inside one; disabled ignores both.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Window } from 'happy-dom';

import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
/** The window under test. `MouseEvent`/`TouchEvent` are not in the installed
 *  global list, so the constructors are taken from here — a bare `new MouseEvent`
 *  reads the RUNNER's global, which Bun does not define, and dies with
 *  `ReferenceError` inside `act()`. */
let win: Window;

beforeEach(() => {
  win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

/** Mounts a box that owns the hook and returns the outside-press counter. */
function mountBox(enabled: boolean): { outside: () => number; box: HTMLElement } {
  const state = { count: 0 };
  const box = document.createElement('div');
  function Box() {
    const ref = { current: box };
    useOnClickOutside(ref, () => { state.count += 1; }, enabled);
    return h('div', { 'data-testid': 'box' }, 'inside');
  }
  // The ref must point at the element the listener tests membership against, so
  // the component renders INTO it rather than into the harness container.
  document.body.appendChild(box);
  act(() => render(h(Box, {}), box));
  return { outside: () => state.count, box };
}

/**
 * Dispatch a press of one of the two types the hook listens for.
 *
 * Built from the WINDOW UNDER TEST, not the runner's globals: Bun defines
 * neither `MouseEvent` nor `TouchEvent`, so a bare constructor throws
 * `ReferenceError` from inside `act()` and the failure names Preact rather than
 * the test.
 */
function press(target: Element, type: 'mousedown' | 'touchstart'): void {
  const view = win as unknown as { MouseEvent: new (t: string, i?: unknown) => globalThis.Event;
    TouchEvent: new (t: string, i?: unknown) => globalThis.Event };
  const Ctor = type === 'mousedown' ? view.MouseEvent : view.TouchEvent;
  target.dispatchEvent(new Ctor(type, { bubbles: true }));
}

describe('useOnClickOutside', () => {
  test('armed: an outside press fires it, an inside press does not', () => {
    const { outside } = mountBox(true);

    act(() => { press(document.body, 'mousedown'); });
    expect(outside()).toBe(1);

    const inner = document.querySelector('[data-testid="box"]') as HTMLElement;
    act(() => { press(inner, 'mousedown'); });
    expect(outside()).toBe(1);
  });

  test('disabled: no listener at all, in either direction', () => {
    const { outside } = mountBox(false);

    act(() => { press(document.body, 'mousedown'); });
    act(() => { press(document.body, 'touchstart'); });
    expect(outside()).toBe(0);
  });

  test('it listens to touch as well, which is what a phone actually sends', () => {
    const { outside } = mountBox(true);
    act(() => { press(document.body, 'touchstart'); });
    expect(outside()).toBe(1);
  });
});
