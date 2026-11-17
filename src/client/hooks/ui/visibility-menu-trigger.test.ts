/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's right-click: a long press opens the same visibility menu the
 * desktop rails and navbar open on `contextmenu`.
 *
 * Four rules, each a way the gesture would otherwise misbehave:
 *
 * 1. **A right-click still works.** A desktop showing the phone layout keeps
 *    the menu it had, anchored to the surface rather than to the pixel.
 * 2. **A hold opens at the press point.** There is no cursor to anchor to.
 * 3. **The click the same gesture produces is swallowed.** Lifting the finger
 *    after the menu opened must not also press the control underneath.
 * 4. **A press that moves is a scroll.** The surface is a scroller on a phone;
 *    a flick that starts on it must not open a menu.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import {
  useVisibilityMenuTrigger,
  type VisibilityMenuTrigger,
} from '@/client/hooks/ui/visibility-menu-trigger';

let win: Window;
let container: HTMLElement;
let trigger: VisibilityMenuTrigger | null = null;
let clicks = 0;

beforeEach(() => {
  vi.useFakeTimers();
  win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  container = document.createElement('div');
  document.body.appendChild(container);
  trigger = null;
  clicks = 0;
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
  vi.useRealTimers();
});

/** Mount the hook on a surface with one child control. */
async function mount(coarse: boolean): Promise<void> {
  win.matchMedia = ((query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof win.matchMedia;

  const Probe = () => {
    trigger = useVisibilityMenuTrigger();
    return h(
      'div',
      { 'data-testid': 'surface', ...trigger.surfaceProps },
      h('button', { 'data-testid': 'child', onClick: () => { clicks += 1; } }, 'child'),
    );
  };
  await act(async () => {
    render(h(Probe, {}), container);
  });
}

/** A touch event carrying one finger at `(x, y)`. */
function touch(type: string, x: number, y: number): globalThis.TouchEvent {
  const event = new win.Event(type, { bubbles: true, cancelable: true }) as unknown as globalThis.TouchEvent;
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }],
  });
  return event;
}

describe('useVisibilityMenuTrigger', () => {
  test('a right-click anchors the menu to the surface', async () => {
    await mount(false);
    (container.querySelector('[data-testid="surface"]') as HTMLElement).getBoundingClientRect = () => ({
      top: 10, bottom: 50, left: 20, right: 120, width: 100, height: 40, x: 20, y: 10,
      toJSON: () => ({}),
    });

    act(() => {
      (container.querySelector('[data-testid="surface"]') as HTMLElement).dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }) as unknown as Event);
    });

    expect(trigger!.anchor).toEqual({ top: 10, bottom: 50, left: 20, right: 120 });
  });

  test('a hold opens the menu at the press point and swallows the click', async () => {
    await mount(true);

    act(() => {
      (container.querySelector('[data-testid="surface"]') as HTMLElement).dispatchEvent(touch('touchstart', 30, 40));
    });
    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    expect(trigger!.anchor).toEqual({ top: 40, bottom: 40, left: 30, right: 30 });

    act(() => {
      (container.querySelector('[data-testid="child"]') as HTMLElement).dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event);
    });
    expect(clicks).toBe(0);

    // The suppression is one-shot: the next tap is the user's own.
    act(() => {
      (container.querySelector('[data-testid="child"]') as HTMLElement).dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event);
    });
    expect(clicks).toBe(1);
  });

  test('a press that moves is a scroll, not a menu', async () => {
    await mount(true);

    act(() => {
      (container.querySelector('[data-testid="surface"]') as HTMLElement).dispatchEvent(touch('touchstart', 30, 40));
    });
    act(() => {
      (container.querySelector('[data-testid="surface"]') as HTMLElement).dispatchEvent(touch('touchmove', 60, 40));
    });
    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    expect(trigger!.anchor).toBeNull();
  });

  test('a mouse hold does not open the menu', async () => {
    await mount(false);

    act(() => {
      (container.querySelector('[data-testid="surface"]') as HTMLElement).dispatchEvent(touch('touchstart', 30, 40));
    });
    await act(async () => {
      vi.advanceTimersByTime(450);
    });

    expect(trigger!.anchor).toBeNull();
  });
});
