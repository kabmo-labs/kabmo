/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Long press: the only way a finger reaches a Files-panel row's menu.
 *
 * Three rules are load-bearing and each was a way the gesture would misbehave
 * on a phone:
 *
 * 1. **A press that MOVES is a scroll.** The tree is a scroller, and a hold that
 *    begins a flick must cancel — otherwise every scroll that starts on a row
 *    opens a menu.
 * 2. **The click the same gesture produces is swallowed.** Lifting the finger
 *    after the menu opened would otherwise also toggle the folder it opened for;
 *    the platform raises both events for one gesture and marks neither.
 * 3. **It is inert without a finger.** A desktop holding its primary button down
 *    is a drag, and a mouse already has a right button.
 *
 * Time is driven, never slept through: a 450 ms hold is a real wait, and the
 * hook's decisions are all about WHICH event arrives, never about how long the
 * test took.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { useLongPress, type LongPressHandlers } from '@/client/hooks/ui/long-press';

let win: Window;
let container: HTMLElement;
let handlers: LongPressHandlers | null = null;
const fired: Array<{ x: number; y: number }> = [];

beforeEach(() => {
  vi.useFakeTimers();
  win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  container = document.createElement('div');
  document.body.appendChild(container);
  fired.length = 0;
  handlers = null;
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
  vi.useRealTimers();
});

/** Mount the hook; `enabled` is what a touch device decides. */
async function mount(enabled: boolean): Promise<void> {
  const Probe = () => {
    handlers = useLongPress({ enabled, onLongPress: (x, y) => fired.push({ x, y }) });
    return null;
  };
  await act(async () => {
    render(h(Probe, {}), container);
  });
}

/** A touch event carrying one finger at `(x, y)`. */
function touch(type: string, x: number, y: number): globalThis.TouchEvent {
  const event = new win.Event(type, { bubbles: true, cancelable: true }) as unknown as globalThis.TouchEvent;
  Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }] });
  return event;
}

/** Advance the hook's own timer, without waiting on a real clock. */
async function holdFor(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useLongPress', () => {
  test('a hold fires at the press point', async () => {
    await mount(true);

    await act(async () => {
      handlers!.onTouchStart(touch('touchstart', 40, 80));
    });
    await holdFor(520);

    expect(fired).toEqual([{ x: 40, y: 80 }]);
  });

  test('a press released before the threshold never fires', async () => {
    await mount(true);

    await act(async () => {
      handlers!.onTouchStart(touch('touchstart', 40, 80));
    });
    await act(async () => {
      handlers!.onTouchEnd();
    });
    await holdFor(520);

    expect(fired).toEqual([]);
  });

  test('a press that MOVES is a scroll, not a press', async () => {
    await mount(true);

    await act(async () => {
      handlers!.onTouchStart(touch('touchstart', 40, 80));
      // Past the slop: the first few pixels of a flick arrive immediately, and
      // a menu that opened on them would make the tree unscrollable.
      handlers!.onTouchMove(touch('touchmove', 40, 140));
    });
    await holdFor(520);

    expect(fired).toEqual([]);
  });

  test('a small drift inside the slop still counts as a hold', async () => {
    await mount(true);

    await act(async () => {
      handlers!.onTouchStart(touch('touchstart', 40, 80));
      handlers!.onTouchMove(touch('touchmove', 42, 83));
    });
    await holdFor(520);

    expect(fired).toHaveLength(1);
  });

  test('a cancelled press never fires', async () => {
    await mount(true);

    await act(async () => {
      handlers!.onTouchStart(touch('touchstart', 40, 80));
      handlers!.onTouchCancel();
    });
    await holdFor(520);

    expect(fired).toEqual([]);
  });

  test('the click after a fired press is consumed exactly once', async () => {
    await mount(true);

    await act(async () => {
      handlers!.onTouchStart(touch('touchstart', 40, 80));
    });
    await holdFor(520);

    // The first click belongs to the gesture that opened the menu; a second
    // click is the user's own and must work.
    expect(handlers!.consume()).toBe(true);
    expect(handlers!.consume()).toBe(false);
  });

  test('no press means nothing to consume', async () => {
    await mount(true);

    expect(handlers!.consume()).toBe(false);
  });

  test('it is inert without a finger', async () => {
    await mount(false);

    await act(async () => {
      handlers!.onTouchStart(touch('touchstart', 40, 80));
    });
    await holdFor(520);

    expect(fired).toEqual([]);
  });
});
