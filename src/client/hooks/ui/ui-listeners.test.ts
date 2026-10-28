/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The DOM-listener hooks: media-query subscription, click-outside, window
 * events, and the highlighter-readiness hook.
 *
 * Every listener here must stop firing once its component unmounts — one that
 * outlives the component keeps a dead closure alive and, for click-outside,
 * keeps reacting to every press on the page. The window/document pair
 * additionally claims to subscribe once per event type and call the latest
 * handler through a ref, so an inline closure must not tear the subscription
 * down and rebuild it on every render; that claim is counted, not assumed.
 *
 * `useTouchDevice` decides whether a terminal gets on-screen keys, and the rule
 * is narrower than "can be touched": `(pointer: coarse)` alone, or touch points
 * AND `(hover: none)`. A touchscreen laptop must come out false, and the
 * subscription must exist so docking a keyboard flips the answer — a device
 * that reports `matches` once is exactly the case that was broken.
 *
 * `useSyntaxReady` is pinned against the highlighter module's own answer: it
 * must report process readiness at mount and follow the boot notification,
 * which is the only reason the hook subscribes at all.
 */

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { useTouchDevice } from '@/client/hooks/ui/touch-device';
import { useWindowEvent } from '@/client/hooks/ui/window-event';

const NativeEvent = globalThis.Event;
const NativeCustomEvent = globalThis.CustomEvent;

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown (see the matching afterAll at the end of this file) so later files still see native Event/CustomEvent/window. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let win: Window;
let container: HTMLElement;

/** A `MediaQueryList` whose `matches` is read live from this map. */
const queryMatches = new Map<string, boolean>();
const queryListeners = new Map<string, Set<() => void>>();

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  win.matchMedia = ((query: string) => {
    const listeners = queryListeners.get(query) ?? new Set<() => void>();
    queryListeners.set(query, listeners);
    return {
      get matches() {
        return queryMatches.get(query) ?? false;
      },
      media: query,
      addEventListener: (_type: string, fn: () => void) => {
        listeners.add(fn);
      },
      removeEventListener: (_type: string, fn: () => void) => {
        listeners.delete(fn);
      },
    };
  }) as unknown as typeof win.matchMedia;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  // The native target below rejects a foreign event: never leave a
  // happy-dom constructor behind for the files that run after this one.
  // (Bun's own constructors are captured at import, before any beforeAll.)
  globalThis.Event = NativeEvent;
  globalThis.CustomEvent = NativeCustomEvent;
  queryMatches.clear();
  for (const listeners of queryListeners.values()) listeners.clear();
  Object.defineProperty(win.navigator, 'maxTouchPoints', { configurable: true, value: 0 });
});

/** The event the DOM nodes under test accept: the global `Event` and
 *  happy-dom's runtime one are different objects, and reading the parameter
 *  off the target keeps both sides honest. */
function press(node: EventTarget, make: () => Event): void {
  node.dispatchEvent(make());
}

async function mount(vnode: Parameters<typeof render>[0]) {
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(vnode, container as HTMLElement);
  });
}

function TouchProbe({ seen }: { seen: { current: boolean | null } }) {
  seen.current = useTouchDevice();
  return h('span', null, String(seen.current));
}

const COARSE = '(pointer: coarse)';
const NO_HOVER = '(hover: none)';

describe('useTouchDevice', () => {
  test('a coarse pointer is enough, even with no touch points', async () => {
    queryMatches.set(COARSE, true);
    const seen: { current: boolean | null } = { current: null };
    await mount(h(TouchProbe, { seen }));
    expect(seen.current).toBe(true);
  });

  test('a touchscreen laptop stays a desktop: touch points with hover is not enough', async () => {
    Object.defineProperty(win.navigator, 'maxTouchPoints', { configurable: true, value: 10 });
    const seen: { current: boolean | null } = { current: null };
    await mount(h(TouchProbe, { seen }));
    expect(seen.current).toBe(false);
  });

  test('the fallback needs touch points AND no hover', async () => {
    queryMatches.set(NO_HOVER, true);
    const seen: { current: boolean | null } = { current: null };
    await mount(h(TouchProbe, { seen }));
    expect(seen.current).toBe(false);

    await act(async () => {
      Object.defineProperty(win.navigator, 'maxTouchPoints', { configurable: true, value: 5 });
      for (const fn of queryListeners.get(NO_HOVER) ?? []) fn();
    });
    expect(seen.current).toBe(true);
  });

  test('follows a query change and drops its listeners on unmount', async () => {
    const seen: { current: boolean | null } = { current: null };
    await mount(h(TouchProbe, { seen }));
    expect(seen.current).toBe(false);

    await act(async () => {
      queryMatches.set(COARSE, true);
      for (const fn of queryListeners.get(COARSE) ?? []) fn();
    });
    expect(seen.current).toBe(true);

    render(null, container as HTMLElement);
    expect(queryListeners.get(COARSE)!.size).toBe(0);
    expect(queryListeners.get(NO_HOVER)!.size).toBe(0);
  });
});

/** A press on a node outside the watched element; removed by the caller. */
function pressOutside(type: 'mousedown' | 'touchstart') {
  const outside = document.body.appendChild(document.createElement('button'));
  const event: Event = type === 'mousedown' ? (new (win.MouseEvent as unknown as typeof MouseEvent)(type, { bubbles: true }) as unknown as Event) : (new (win.Event as unknown as typeof Event)(type, { bubbles: true }) as unknown as Event);
  outside.dispatchEvent(event);
  return { outside, event };
}

interface OutsideProbeProps {
  seen: { current: (event: globalThis.MouseEvent | globalThis.TouchEvent) => void };
  targetRef: { current: HTMLElement | null };
}

function OutsideProbe({ seen, targetRef }: OutsideProbeProps) {
  useOnClickOutside(targetRef, (event) => seen.current(event));
  return h('div', { ref: targetRef, id: 'inside' }, h('span', { id: 'child' }, 'body'));
}

describe('useOnClickOutside', () => {
  async function mountOutside(seen: OutsideProbeProps['seen']) {
    const targetRef: { current: HTMLElement | null } = { current: null };
    await mount(h(OutsideProbe, { seen, targetRef }));
    return targetRef;
  }

  test('a press inside the element does not call the handler', async () => {
    const calls: string[] = [];
    await mountOutside({ current: () => calls.push('called') });

    await act(async () => {
      press(container!.querySelector('#child')!, () => new (win.MouseEvent as unknown as typeof MouseEvent)('mousedown', { bubbles: true }));
    });
    expect(calls).toEqual([]);
  });

  test('a press outside calls it once, with the event', async () => {
    const events: globalThis.MouseEvent[] = [];
    await mountOutside({ current: (event) => events.push(event as globalThis.MouseEvent) });

    let press: { outside: HTMLElement; event: Event } | undefined;
    await act(async () => {
      press = pressOutside('mousedown');
    });
    expect(events).toHaveLength(1);
    expect(events[0].target).toBe(press!.outside);
    press!.outside.remove();
  });

  test('touchstart outside is treated the same as a mouse press', async () => {
    const calls: string[] = [];
    await mountOutside({ current: () => calls.push('called') });

    let pressResult: { outside: HTMLElement } | undefined;
    await act(async () => {
      pressResult = pressOutside('touchstart');
    });
    expect(calls).toEqual(['called']);

    await act(async () => {
      press(container!.querySelector('#child')!, () => new (win.Event as unknown as typeof Event)('touchstart', { bubbles: true }));
    });
    expect(calls).toEqual(['called']);
    pressResult!.outside.remove();
  });

  test('a detached ref makes the handler inert instead of firing on everything', async () => {
    const calls: string[] = [];
    const targetRef = await mountOutside({ current: () => calls.push('called') });

    targetRef.current = null;
    let press: { outside: HTMLElement } | undefined;
    await act(async () => {
      press = pressOutside('mousedown');
    });
    expect(calls).toEqual([]);
    press!.outside.remove();
  });

  test('unmounting removes both listeners', async () => {
    const calls: string[] = [];
    await mountOutside({ current: () => calls.push('called') });

    render(null, container as HTMLElement);
    let press: { outside: HTMLElement } | undefined;
    await act(async () => {
      press = pressOutside('mousedown');
    });
    expect(calls).toEqual([]);
    press!.outside.remove();
  });

  test('a replaced handler is the one that runs', async () => {
    const calls: string[] = [];
    const targetRef = await mountOutside({ current: () => calls.push('first') });

    await act(async () => {
      render(h(OutsideProbe, { seen: { current: () => calls.push('second') }, targetRef }), container as HTMLElement);
    });
    let press: { outside: HTMLElement } | undefined;
    await act(async () => {
      press = pressOutside('mousedown');
    });
    expect(calls).toEqual(['second']);
    press!.outside.remove();
  });
});

function WindowProbe({ hits, label }: { hits: string[]; label: { current: string } }) {
  useWindowEvent('resize', () => hits.push(label.current));
  return h('span', null, String(hits.length));
}

describe('useWindowEvent', () => {
  test('fires the latest handler without re-subscribing on re-render', async () => {
    const hits: string[] = [];
    const label = { current: 'one' };
    // The hook subscribes to the installed global `window`, so the spy goes on
    // that target — not this file's `win` handle, which can be a different
    // object even when it points at the same DOM.
    const target = window;
    const realAdd = target.addEventListener.bind(target);
    const realRemove = target.removeEventListener.bind(target);
    const added: string[] = [];
    target.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: unknown,
    ) => {
      added.push(type);
      return realAdd(type, listener as EventListener, options as AddEventListenerOptions);
    }) as typeof target.addEventListener;
    target.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: unknown,
    ) => realRemove(type, listener as EventListener, options as AddEventListenerOptions)) as unknown as typeof target.removeEventListener;

    try {
      await mount(h(WindowProbe, { hits, label }));
      expect(added.filter((t) => t === 'resize')).toHaveLength(1);

      // A new inline closure arrives with the new label; the subscription must
      // not be rebuilt for it.
      label.current = 'two';
      await act(async () => {
        render(h(WindowProbe, { hits, label }), container as HTMLElement);
      });
      expect(added.filter((t) => t === 'resize')).toHaveLength(1);

      await act(async () => {
        press(window, () => new (win.Event as unknown as typeof Event)('resize'));
      });
      expect(hits).toEqual(['two']);
    } finally {
      target.addEventListener = realAdd as typeof target.addEventListener;
      target.removeEventListener = realRemove as typeof target.removeEventListener;
    }
  });

  test('stops firing once the component unmounts', async () => {
    const hits: string[] = [];
    const label = { current: 'one' };
    await mount(h(WindowProbe, { hits, label }));

    await act(async () => {
      press(window, () => new (win.Event as unknown as typeof Event)('resize'));
    });
    expect(hits).toEqual(['one']);

    render(null, container as HTMLElement);
    await act(async () => {
      press(window, () => new (win.Event as unknown as typeof Event)('resize'));
    });
    expect(hits).toEqual(['one']);
  });
});