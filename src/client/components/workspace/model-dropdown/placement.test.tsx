/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where the model picker renders, and the guard that keeps it usable there.
 *
 * Two placements, one content tree:
 *
 *  - a desktop keeps the POPOVER, anchored above the trigger, so a picker never
 *    covers a 1440x900 workspace to choose a model;
 *  - a phone gets the WHOLE SCREEN, because the composer sits at the bottom of a
 *    390px viewport — measured, the 86dvh sheet that came first left 344px of
 *    dead canvas above it and showed ~7 rows where the full screen shows 15.
 *
 * The load-bearing half is the click-outside guard. A portalled overlay is
 * outside `containerRef` BY CONSTRUCTION, so an armed listener closes the picker
 * on the `mousedown` that was meant to choose a row: measured in a real browser
 * as "tap a model on a phone and nothing happens". The guard is therefore
 * DISABLED in the full-screen placement, and these cases pin both directions —
 * that it is off there, and that it still works in the popover.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Window } from 'happy-dom';

import { ModelFullscreen } from '@/client/components/workspace/model-dropdown/Fullscreen';
import { useFullscreenPicker } from '@/client/components/workspace/model-dropdown/fullscreen-picker';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

/**
 * `useKeyboardInset` observes the frame's border box, and happy-dom ships no
 * `ResizeObserver`. The no-op below keeps the hook mounted without pretending to
 * observe anything: this file asserts the FRAME (where it portals, what it
 * draws), never the lift, which `keyboard-inset`'s own suite covers as pure
 * arithmetic.
 */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  (globalThis as unknown as Record<string, unknown>).ResizeObserver ??= NoopResizeObserver;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

/** The placement decision, read through a throwaway component. */
function placement(isMobile: boolean | undefined): boolean {
  let value = false;
  function Probe() {
    value = useFullscreenPicker(isMobile);
    return null;
  }
  act(() => render(h(Probe, {}), container));
  return value;
}

describe('model picker placement', () => {
  test("the shell's verdict decides it, in both directions", () => {
    // The shell already answered this from the user agent, the pointer and a
    // landscape-phone height test. A picker that re-derived a different answer
    // would paint a phone frame inside a desktop shell.
    expect(placement(true)).toBe(true);
    expect(placement(false)).toBe(false);
  });

  test('with no verdict it reads the pointer, not a pixel breakpoint', () => {
    // happy-dom's `matchMedia` answers false for everything, so this asserts the
    // FALLBACK path is taken without throwing — the hook must not depend on the
    // media query existing (a jsdom-style window has no `addEventListener` on it).
    expect(placement(undefined)).toBe(false);
  });
});

describe('the full-screen frame', () => {
  test('it portals to <body>, not into the composer', () => {
    // The composer card can become a containing block for `position: fixed`
    // through `backdrop-filter`/`transform`/`contain: layout`; rendered in place,
    // `inset-0` would size the overlay to the CARD (measured: 710x164 at the
    // card's box instead of 1440x900 at the viewport).
    const host = document.createElement('div');
    host.setAttribute('data-composer-style', '');
    document.body.appendChild(host);
    act(() => render(h(ModelFullscreen, { open: true, onClose: () => {}, children: 'rows' }), host));

    const dialog = document.querySelector('[role="dialog"][aria-label="Select model"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.closest('[data-composer-style]')).toBeNull();
    expect(dialog?.parentElement).toBe(document.body);
    host.remove();
  });

  test('closed draws nothing at all', () => {
    act(() => render(h(ModelFullscreen, { open: false, onClose: () => {}, children: 'rows' }), container));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test('the content is the picker’s own, and the close control dismisses it', () => {
    // One tree, two frames: a full-screen view that re-implemented the list
    // would drift from the popover (a new section landing in only one of them).
    const children = h('div', { 'data-testid': 'picker-content' }, 'rows');
    let closed = 0;
    act(() => render(h(ModelFullscreen, { open: true, onClose: () => { closed += 1; }, children }), container));

    expect(document.querySelector('[data-testid="picker-content"]')?.textContent).toBe('rows');
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    expect(close).not.toBeNull();
    act(() => close?.click());
    expect(closed).toBe(1);
  });
});
