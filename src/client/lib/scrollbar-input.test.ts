/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';

import { SCROLLBAR_ACTIVE_ATTRIBUTE } from '@/client/lib/scrollbar-activity';
import {
  IDLE_MS,
  freshPage,
  inputAt,
  keyAt,
  restoreNativeGlobals,
  saveNativeGlobals,
  scrollAt,
  scrollSurface,
  scroller,
} from '@/client/lib/scrollbar-probe.test-util';

beforeAll(saveNativeGlobals);
afterAll(restoreNativeGlobals);
afterEach(() => {
  jest.useRealTimers();
});

/**
 * The bar appears the moment the reader scrolls.
 *
 * Every case here asserts paint WITHOUT a `scroll` event: the reveal is driven
 * by the input itself, so these fail if the rule goes back to waiting for the
 * frame the browser dispatches `scroll` on (the reported "the scrollbar does
 * not show up immediately when I scroll"). Measured before this rule: the
 * attribute landed 13-27ms after a wheel, on the scroll frame, and a scroll
 * the gate declined painted nothing at all.
 */

describe('the scrollbar reveal on input', () => {
  test('a wheel paints the surface it is over, before any scroll event', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scrollSurface();

    // No `scrollAt()`: this is the whole point. The bar is painted by the
    // input, not by a scroll event the browser dispatches a frame later (or
    // never, when the gate declines it). Measured before this rule: the
    // attribute landed 13-27ms after the wheel, i.e. on the scroll frame, and
    // a scroll the gate refused painted nothing at all.
    inputAt(box);

    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);
  });

  test('a wheel over a child paints the scroller that holds it', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scrollSurface();
    const row = document.createElement('p');
    box.appendChild(row);

    inputAt(row);

    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);
    expect(row.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('a wheel over something that cannot scroll paints nothing', () => {
    jest.useFakeTimers();
    freshPage();
    const plain = scroller();

    inputAt(plain);

    // The page's own reveal belongs to its `scroll` event, where the painted
    // surface is the root element. Lighting it here would paint the page's bar
    // for a wheel that moved nothing at all.
    expect(plain.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
    expect(document.documentElement.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('every wheel of a gesture restarts the idle window', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scrollSurface();

    inputAt(box);
    jest.advanceTimersByTime(IDLE_MS - 100);
    inputAt(box);
    jest.advanceTimersByTime(IDLE_MS - 100);

    // The user is STILL scrolling: a bar that faded here would disappear from
    // under a hand that never stopped.
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);

    jest.advanceTimersByTime(100);
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('a keyboard scroll reveals the surface the engine scrolled', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    // MEASURED in Chromium and WebKit 27.2: PageDown with nothing focused walks
    // the focused scroll chain, so the keydown's target is `body` while the
    // panel that moves is a sibling subtree. Binding the arm to `body` refused
    // every keyboard scroll, so the bar never appeared for them.
    keyAt('PageDown');
    scrollAt(box);

    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);
  });

  test('a key that cannot scroll does not arm a reveal', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    // Typing in the composer must not let a stream's next auto-follow paint a
    // bar: the key says nothing about scrolling.
    keyAt('a');
    scrollAt(box);

    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });
});
