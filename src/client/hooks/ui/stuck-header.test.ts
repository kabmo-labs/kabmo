/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useStuckHeader`: a sticky element's PINNED state.
 *
 * The rule this pins is the one the sidebar depends on: a sticky header paints a
 * surface only while it is overlapping content. Measured with happy-dom's scroll
 * geometry, because the alternative — trusting the CSS — is what shipped a band
 * across a uniform sidebar twice.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useRef } from 'preact/hooks';
import { useStuckHeader } from '@/client/hooks/ui/stuck-header';

// `requestAnimationFrame` is in the list because the HOOK schedules through it
// and happy-dom keeps it on its window, not on the runner's global.
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'Event',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  // `preact/test-utils`' `act` reads this one to flush effects.
  'getComputedStyle',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;
let scroller: HTMLElement;
/** The header's current top, in container coordinates. Mutated per assertion. */
let headerTop = 0;
/** The container's scroll offset. Zero is "at rest" — nothing overlapping. */
let scrollTop = 0;

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = win[key as keyof Window];
    target[key] = win[key as keyof Window];
  }
  // A SYNCHRONOUS frame: the hook coalesces scroll events through
  // `requestAnimationFrame`, and a real one is a timer this suite would have to
  // wait on. Running the callback inline measures the same logic with no clock.
  target.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof requestAnimationFrame;
  target.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

  container = document.createElement('div');
  document.body.appendChild(container);
  headerTop = 0;
  scrollTop = 0;
});

afterEach(() => {
  render(null, container);
  container.remove();
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key in nativeGlobals) target[key] = nativeGlobals[key];
    else delete target[key];
  }
});

/**
 * A scroll container with a sticky header inside it.
 *
 * happy-dom has no layout engine, so the geometry is supplied: the container's
 * `getBoundingClientRect().top` and the header's are both overridden, which is
 * exactly what `useStuckHeader` reads. The header's rect is a LIVE getter over
 * `headerTop`, so a test scrolls by changing one number.
 */
function mountHarness(): HTMLElement {
  function Probe() {
    const ref = useRef<HTMLDivElement>(null);
    const stuck = useStuckHeader(ref);
    return h('div', { ref, 'data-stuck': stuck ? '' : undefined, 'data-testid': 'header' });
  }

  scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 300, configurable: true });
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
    configurable: true,
  });
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  container.appendChild(scroller);

  // `act` so the effect runs (and attaches its listener) before the geometry is
  // supplied; without it the mount measurement reads happy-dom's zero rect and
  // no later scroll would be heard.
  act(() => {
    render(h(Probe, null), scroller);
  });
  const header = scroller.querySelector('[data-testid="header"]') as HTMLElement;
  header.getBoundingClientRect = () => ({ top: headerTop, bottom: headerTop + 26 }) as DOMRect;
  return header;
}

/**
 * Scroll the harness and wait for the hook's OWN measurement.
 *
 * The hook coalesces scroll events into a `requestAnimationFrame`, so the signal
 * to await is that frame — awaited directly rather than guessed at with a sleep,
 * which would pay real latency per run and still flake under load.
 */
/** Move the list: `top` is where the header now sits, `offset` how far it scrolled. */
function scrollTo(top: number, offset: number) {
  headerTop = top;
  scrollTop = offset;
  act(() => {
    scroller.dispatchEvent(new Event('scroll'));
  });
}

describe('useStuckHeader', () => {
  test('a header below the container top is at rest', () => {
    const header = mountHarness();
    scrollTo(120, 0);

    expect(header.hasAttribute('data-stuck')).toBe(false);
  });

  test('a header at the container top is NOT stuck before the list scrolls', () => {
    // The regression this guards: the geometric test alone is true at
    // `scrollTop: 0` for a header that starts at the top edge, so the surface
    // appeared before anything overlapped it.
    const header = mountHarness();
    headerTop = 0;
    scrollTop = 0;
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });

    expect(header.hasAttribute('data-stuck')).toBe(false);
  });

  test('a header level with the container top is stuck', () => {
    const header = mountHarness();
    scrollTo(0, 120);

    expect(header.hasAttribute('data-stuck')).toBe(true);
  });

  test('a header whose section scrolled past is not painted', () => {
    // It sits entirely above the container: sticky keeps it out of sight, so a
    // fill there is work for a surface nobody can see.
    const header = mountHarness();
    scrollTo(-60, 400);

    expect(header.hasAttribute('data-stuck')).toBe(false);
  });

  test('scrolling re-measures, in both directions', () => {
    const header = mountHarness();
    scrollTo(120, 0);
    expect(header.hasAttribute('data-stuck')).toBe(false);

    // The user scrolls the list: the sticky header is now pinned.
    scrollTo(0, 120);
    expect(header.hasAttribute('data-stuck')).toBe(true);

    // …and scrolls back to the top: it is the first line of the list again.
    scrollTo(40, 0);
    expect(header.hasAttribute('data-stuck')).toBe(false);
  });
});
