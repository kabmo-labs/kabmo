/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';

import {
  SCROLLBAR_ACTIVE_ATTRIBUTE,
  SCROLLBAR_IDLE_MS,
  installScrollbarActivity,
} from '@/client/lib/scrollbar-activity';
import {
  ARM_MS,
  IDLE_MS,
  freshPage,
  inputAt,
  restoreNativeGlobals,
  saveNativeGlobals,
  scrollAt,
  scroller,
} from '@/client/lib/scrollbar-probe.test-util';

beforeAll(saveNativeGlobals);
afterAll(restoreNativeGlobals);
afterEach(() => {
  jest.useRealTimers();
});

/**
 * The reveal gate: which scrolls may paint a bar, and for how long.
 *
 * A `scroll` event alone is not proof of a user — a stream's auto-follow emits
 * real, trusted scroll events — so the gate asks whether the user's input
 * produced this scroll. Everything here is that question, its escape hatches
 * (a held pointer, a delayed delivery) and the fade window.
 */

describe('the scrollbar reveal gate', () => {
  test('a user-driven scroll on a nested container reveals ITS bar, not the page\'s', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    inputAt(box);
    scrollAt(box);

    // The reveal lands on the element that scrolled. A bubble-phase listener
    // would leave this unset and set the root's instead.
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);
    expect(document.documentElement.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('a scroll with no input behind it reveals nothing', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    // What `el.scrollTop = n`, a smooth `scrollTo`, a streaming auto-follow and
    // a `scrollIntoView` all produce. The browser marks it trusted, so the only
    // signal that separates it from a user's scroll is whether the user was
    // there.
    scrollAt(box);

    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('the bar hides again after the idle window', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    inputAt(box);
    scrollAt(box);
    jest.advanceTimersByTime(IDLE_MS - 1);
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);

    jest.advanceTimersByTime(1);
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('a user scroll during the cool-down restarts the whole window', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    inputAt(box);
    scrollAt(box);
    jest.advanceTimersByTime(IDLE_MS - 300);
    inputAt(box);
    scrollAt(box);
    jest.advanceTimersByTime(IDLE_MS - 300);

    // Well past the first scroll's deadline, but only 700ms since the second:
    // still lit. A handler that queued a second timer instead of clearing the
    // first would have hidden it at the original mark.
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);

    jest.advanceTimersByTime(300);
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('a programmatic scroll does not extend a live reveal', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    inputAt(box);
    scrollAt(box);
    // That scroll SPENT the arm, so this one — 100ms later, still well inside
    // the arm's own expiry and inside the idle window — has nothing behind it.
    jest.advanceTimersByTime(100);
    scrollAt(box);
    jest.advanceTimersByTime(IDLE_MS - 100);

    // The fade runs on the USER's clock. Re-arming it here is exactly the bug
    // that pinned the chat timeline's bar on screen for a whole stream.
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('an arm older than its expiry does not vouch for a later scroll', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    inputAt(box);
    jest.advanceTimersByTime(ARM_MS + 1);
    scrollAt(box);

    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('a scroll delivered after a long frame is still the user\'s', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    // A wheel arrives, the main thread spends the next frame in a streamed
    // render, and the scroll it caused is only delivered afterwards. Measured
    // live in WebKit 27.2: a 700ms blocked frame produced a scroll stamped
    // 703ms after the wheel — far outside any 250ms window — while the
    // container had moved 240px. The arm is not a window: it is still unspent.
    //
    // The clock is advanced first so both events carry a real stamp: the fake
    // clock starts at 0, and a zero stamp is what `eventMoment` treats as
    // "unstamped".
    jest.advanceTimersByTime(1_000);
    inputAt(box);
    const late = new Event('scroll');
    jest.advanceTimersByTime(700);
    box.dispatchEvent(late);

    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);
  });

  test('a held pointer keeps the bar up for a drag longer than the arm', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    // A scrollbar drag is one press and then a stream of scrolls that can last
    // far longer than the input window; a timestamp alone would fade the bar
    // out from under the finger still dragging it.
    document.dispatchEvent(new Event('pointerdown'));
    for (let elapsed = 0; elapsed < ARM_MS * 4; elapsed += 100) {
      scrollAt(box);
      jest.advanceTimersByTime(100);
    }

    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);

    document.dispatchEvent(new Event('pointerup'));
    jest.advanceTimersByTime(IDLE_MS);
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('an arm belongs to the container the input landed in', () => {
    jest.useFakeTimers();
    freshPage();
    const wheeled = scroller();
    const other = scroller();

    // A wheel that cannot move its container (already at the top) fires no
    // scroll, so its arm stays unspent — and before the arm was bound, the next
    // programmatic scroll ANYWHERE spent it: measured as a bar lighting for a
    // scroll nobody made, 250ms after a dead wheel.
    inputAt(wheeled);
    jest.advanceTimersByTime(250);
    scrollAt(other);

    expect(other.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);

    // The container the input landed in still gets its reveal.
    scrollAt(wheeled);
    expect(wheeled.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);
  });

  test('a release that never arrives does not leave the pointer held', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    // The drag ended outside the window, or the OS took the pointer. A stuck
    // flag would restore the pinned-bar bug one press at a time.
    document.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('blur'));
    jest.advanceTimersByTime(ARM_MS + 1);
    scrollAt(box);

    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('two containers fade independently', () => {
    jest.useFakeTimers();
    freshPage();
    const first = scroller();
    const second = scroller();

    inputAt(first);
    scrollAt(first);
    jest.advanceTimersByTime(IDLE_MS - 400);
    inputAt(second);
    scrollAt(second);

    // The first container's window has elapsed...
    jest.advanceTimersByTime(400);
    expect(first.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
    // ...and the second's has not, because it started 600ms later.
    expect(second.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);
  });

  test('the page scroll reveals the root bar', () => {
    jest.useFakeTimers();
    freshPage();

    // The viewport reports `document` as the target, but the bar that is
    // painted belongs to the root element.
    inputAt();
    document.dispatchEvent(new Event('scroll'));

    expect(document.documentElement.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);
  });

  test('installing twice on one document wires one listener', () => {
    jest.useFakeTimers();
    freshPage();
    installScrollbarActivity(IDLE_MS, ARM_MS);
    const box = scroller();

    // Measured as a DELTA: happy-dom's own Window arms timers of its own, and
    // an absolute count would be asserting those.
    const before = jest.getTimerCount();
    inputAt(box);
    scrollAt(box);
    // A second listener would arm a second fade; the first one firing would
    // clear the attribute while the second is still pending, so the count is
    // what says whether the fade can be cut short.
    expect(jest.getTimerCount() - before).toBe(1);
  });

  test('the idle window is five seconds', () => {
    // The user-facing number, stated once: a change here is a deliberate
    // change to how long a bar lingers, not a tuning tweak.
    expect(SCROLLBAR_IDLE_MS).toBe(5_000);
  });
});
