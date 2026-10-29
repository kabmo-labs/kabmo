/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The app-wide scrollbar reveal rule.
 *
 * What this file pins is the part that is easy to get wrong and impossible to
 * notice by hand: `scroll` does not bubble, so a document listener only sees
 * the reveal if it is registered in the CAPTURE phase with `event.target` read
 * as the scroller. Get that wrong and the code still runs, still adds no error
 * anywhere, and simply never reveals a bar on any container except the page
 * itself — which looks exactly like a CSS problem.
 *
 * The other half is the gate, and it is the reason this module exists in the
 * shape it does: a PROGRAMMATIC scroll is a real, trusted `scroll` event, so a
 * reveal keyed on the event alone pins the bar on screen for as long as
 * anything else moves the container — measured as a chat timeline whose bar
 * never faded during a stream, with nobody touching the page. Every case below
 * that asserts a reveal therefore produces INPUT first, and the cases that
 * assert no reveal are the ones with a bare scroll.
 *
 * Each case gets its OWN document and its own install, because the module is
 * idempotent per document and its input clock is per install: a shared document
 * would make every case inherit the previous one's wheel (and would make a
 * `useFakeTimers` clock that restarts at real time read as recent input).
 *
 * Mounted against happy-dom, the same way the other client tests are.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';

import {
  installScrollbarActivity,
  SCROLLBAR_ACTIVE_ATTRIBUTE,
  SCROLLBAR_IDLE_MS,
  SCROLLBAR_INPUT_ARM_MS,
} from '@/client/lib/scrollbar-activity';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still see native Event/CustomEvent/window. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/** Short enough to drive in a test, long enough that the two windows do not overlap. */
const IDLE_MS = 1_000;
/** The production arm; its real value is what the gate is about. */
const ARM_MS = SCROLLBAR_INPUT_ARM_MS;

beforeAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
  }
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

/**
 * A fresh document with the reveal rule installed on it.
 *
 * A new `Window` is a new `Document`, and the module keys its install guard on
 * the document — so this is the only way to get an install whose input clock
 * has never been touched.
 */
function freshPage(): void {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) target[key] = (win as unknown as Record<string, unknown>)[key];
  installScrollbarActivity(IDLE_MS, ARM_MS);
}

/** A scroll container in the live document. */
function scroller(): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return element;
}

/** The event a browser dispatches at a scroller — it does not bubble. */
function scrollAt(element: Element): void {
  element.dispatchEvent(new Event('scroll'));
}

/** The input a browser delivers before a scroll the USER caused. */
function inputAt(): void {
  document.body.dispatchEvent(new Event('wheel'));
}

describe('installScrollbarActivity', () => {
  test('a user-driven scroll on a nested container reveals ITS bar, not the page\'s', () => {
    jest.useFakeTimers();
    freshPage();
    const box = scroller();

    inputAt();
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

    inputAt();
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

    inputAt();
    scrollAt(box);
    jest.advanceTimersByTime(IDLE_MS - 300);
    inputAt();
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

    inputAt();
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

    inputAt();
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
    inputAt();
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

    inputAt();
    scrollAt(first);
    jest.advanceTimersByTime(IDLE_MS - 400);
    inputAt();
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
    inputAt();
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
