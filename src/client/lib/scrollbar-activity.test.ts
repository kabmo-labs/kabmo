/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
 * The other cases are the ones that would show up as a stuck or flickering
 * thumb: two scrollers fading independently, a scroll during the cool-down
 * extending the fade rather than restarting it from the first one, the root
 * scroller (whose event target is the document but whose bar belongs to the
 * root element), and a second install being a no-op rather than a second
 * listener.
 *
 * Mounted against happy-dom, the same way the other client tests are. The
 * document is swapped in by the harness rather than by the module, so the
 * `WeakSet` guard on `globalThis` is what keeps the second `install` call in
 * one file from being mistaken for the test's own reinstall.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';

import { installScrollbarActivity, SCROLLBAR_ACTIVE_ATTRIBUTE, SCROLLBAR_IDLE_MS } from '@/client/lib/scrollbar-activity';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still see native Event/CustomEvent/window. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let win: Window;

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
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

describe('installScrollbarActivity', () => {
  test('a scroll on a nested container reveals ITS bar, not the page\'s', () => {
    jest.useFakeTimers();
    installScrollbarActivity(100);
    const box = scroller();

    scrollAt(box);

    // The reveal lands on the element that scrolled. A bubble-phase listener
    // would leave this unset and set the root's instead.
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);
    expect(document.documentElement.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('the bar hides again after the idle window', () => {
    jest.useFakeTimers();
    installScrollbarActivity(100);
    const box = scroller();

    scrollAt(box);
    jest.advanceTimersByTime(99);
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);

    jest.advanceTimersByTime(1);
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('a scroll during the cool-down restarts the whole window', () => {
    jest.useFakeTimers();
    installScrollbarActivity(100);
    const box = scroller();

    scrollAt(box);
    jest.advanceTimersByTime(70);
    scrollAt(box);
    jest.advanceTimersByTime(70);

    // 140ms of wall clock, but only 70ms since the last scroll: still lit. A
    // handler that queued a second timer instead of clearing the first would
    // have hidden it at the 100ms mark.
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);

    jest.advanceTimersByTime(30);
    expect(box.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
  });

  test('two containers fade independently', () => {
    jest.useFakeTimers();
    installScrollbarActivity(100);
    const first = scroller();
    const second = scroller();

    scrollAt(first);
    jest.advanceTimersByTime(60);
    scrollAt(second);

    // The first container's window has not elapsed...
    jest.advanceTimersByTime(40);
    expect(first.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(false);
    // ...and the second's has not either, because it started 60ms later.
    expect(second.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);
  });

  test('the page scroll reveals the root bar', () => {
    jest.useFakeTimers();
    installScrollbarActivity(100);

    // The viewport reports `document` as the target, but the bar that is
    // painted belongs to the root element.
    document.dispatchEvent(new Event('scroll'));

    expect(document.documentElement.hasAttribute(SCROLLBAR_ACTIVE_ATTRIBUTE)).toBe(true);
  });

  test('installing twice wires one listener', () => {
    jest.useFakeTimers();
    installScrollbarActivity(100);
    installScrollbarActivity(100);
    const box = scroller();

    scrollAt(box);
    // A second listener would arm a second timer; the first one firing would
    // clear the attribute while the second is still pending, so the count is
    // what says whether the fade can be cut short.
    expect(jest.getTimerCount()).toBe(1);
  });

  test('the idle window is five seconds', () => {
    // The user-facing number, stated once: a change here is a deliberate
    // change to how long a bar lingers, not a tuning tweak.
    expect(SCROLLBAR_IDLE_MS).toBe(5_000);
  });
});
