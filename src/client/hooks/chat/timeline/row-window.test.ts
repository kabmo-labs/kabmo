/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The timeline's mounted window, and the two things that made a rail jump look
 * dead in a real browser.
 *
 *  1. The scroll subscription was keyed on the scroller REF. The timeline
 *     paints a skeleton first and swaps the real body in a commit later, and a
 *     ref identity never changes — so the listener was attached to a detached
 *     node (or to nothing) and the window stayed at the head of the session
 *     while the viewport sat at its tail.
 *
 *  2. The reveal wrote `scrollTop` directly. The container carries Tailwind's
 *     `scroll-smooth`, and CSS `scroll-behavior` applies to the setter too, so
 *     the write ANIMATED and the correction loop re-targeted it every frame —
 *     measured: a 240-message session walked 9 804 → 6 504 px and stopped.
 *     `revealRow` now writes with `behavior: 'instant'`.
 *
 * happy-dom does no layout, so the scroller's geometry is stubbed the way
 * `session-pagination.test.ts` stubs it: heights and `scrollTop` are numbers
 * the test owns, which is enough to drive the window math.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { useTimelineRowWindow as UseRowWindow, TimelineRowWindow } from '@/client/hooks/chat/timeline/row-window';

let useTimelineRowWindow: typeof UseRowWindow;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

let win: Window;
let container: HTMLDivElement;
let rowWindow: TimelineRowWindow | undefined;

/** 400 rows, 100 px each: 40 000 px of content in a 500 px viewport. */
const ROWS = 400;
const ROW_HEIGHT = 100;
const VIEWPORT = 500;

/** Every `scrollTo` call the hook made, so a write's BEHAVIOR is observable. */
const scrollWrites: Array<{ top: number; behavior?: ScrollBehavior }> = [];

/** Frames are queued, never run by the platform, so a test drives them. */
let frames: Array<() => void> = [];

function drainFrames(rounds = 6): void {
  for (let i = 0; i < rounds && frames.length > 0; i += 1) {
    const pending = frames;
    frames = [];
    for (const cb of pending) cb();
  }
}

function installScroller(top: number): HTMLDivElement {
  const el = document.createElement('div');
  const state = { top };
  Object.defineProperty(el, 'scrollHeight', { get: () => ROWS * ROW_HEIGHT, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => VIEWPORT, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    get: () => state.top,
    set: (value: number) => {
      state.top = Math.max(0, Math.min(value, ROWS * ROW_HEIGHT - VIEWPORT));
    },
    configurable: true,
  });
  Object.defineProperty(el, 'scrollTo', {
    value: (options: ScrollToOptions | number) => {
      const opts = typeof options === 'number' ? { top: options } : options;
      scrollWrites.push({ top: opts.top ?? 0, behavior: opts.behavior });
      el.scrollTop = opts.top ?? 0;
    },
    configurable: true,
  });
  return el;
}

function Probe({ node }: { node: HTMLDivElement | null }) {
  rowWindow = useTimelineRowWindow({
    ids: Array.from({ length: ROWS }, (_, i) => `r-${i}`),
    scrollRef: { current: node },
    scrollNode: node,
  });
  return null;
}

async function mount(node: HTMLDivElement | null): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => { render(h(Probe, { node }), container); });
  drainFrames();
}

async function unmount(): Promise<void> {
  if (!container) return;
  await act(async () => { render(null, container); });
  container.remove();
  container = undefined as unknown as HTMLDivElement;
}

beforeAll(async () => {
  win = new Window({ url: 'http://localhost' });
  const globals: Record<string, unknown> = {
    window: win,
    document: win.document,
    navigator: win.navigator,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    Event: win.Event,
    ResizeObserver: win.ResizeObserver,
    requestAnimationFrame: (cb: () => void) => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: () => {},
  };
  for (const [key, value] of Object.entries(globals)) {
    (globalThis as Record<string, unknown>)[key] = value;
  }
  // Preact binds its environment at module evaluation, so the modules below
  // must load after the DOM globals exist. Static imports cannot work here.
  ({ useTimelineRowWindow } = await import('@/client/hooks/chat/timeline/row-window'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

afterEach(async () => {
  await unmount();
  rowWindow = undefined;
  scrollWrites.length = 0;
  frames = [];
});

describe('useTimelineRowWindow', () => {
  test('mounts the window around the viewport, not at the head of the session', async () => {
    await mount(installScroller(20_000));
    expect(rowWindow!.start).toBeGreaterThan(0);
    expect(rowWindow!.end).toBeLessThan(ROWS);
    expect(rowWindow!.padTop).toBeGreaterThan(0);
  });

  test('a surface published a commit late still gets subscribed, and follows scrolling', async () => {
    // The full-panel skeleton owns the first commit: no scroller node yet.
    await mount(null);
    expect(rowWindow!.start).toBe(0);

    const scroller = installScroller(20_000);
    await unmount();
    await mount(scroller);
    const opened = rowWindow!.start;
    expect(opened).toBeGreaterThan(0);

    // A scroll the way the browser delivers one: the listener must be on THIS
    // node. Keyed on the ref, it was attached to nothing and the window froze
    // where it opened.
    scroller.scrollTop = 32_000;
    scroller.dispatchEvent(new win.Event('scroll') as unknown as Event);
    drainFrames();
    await act(async () => {});

    expect(rowWindow!.start).toBeGreaterThan(opened);
  });

  test('a reveal writes the landing instantly, because the container scrolls smoothly', async () => {
    const scroller = installScroller(0);
    await mount(scroller);

    const done = rowWindow!.revealRow('r-300');
    drainFrames(20);
    await done;

    expect(scrollWrites.length).toBeGreaterThan(0);
    // `auto` would resolve to the element's `scroll-smooth`, animating the
    // write and leaving the jump wherever the correction loop stopped.
    expect(scrollWrites.every((write) => write.behavior === 'instant')).toBe(true);
    // r-300 is 300 rows down, well past the tail's own 20 000 px start.
    expect(scroller.scrollTop).toBeGreaterThan(20_000);
  });

  test('a second reveal supersedes the first, so two clicks land on the second turn', async () => {
    // Where a lone reveal of the SECOND row lands.
    const solo = installScroller(0);
    await mount(solo);
    const soloDone = rowWindow!.revealRow('r-350');
    drainFrames(20);
    await soloDone;
    const soloTop = solo.scrollTop;
    await unmount();

    // Two clicks in a row: the first reveal must stop writing the moment the
    // second one starts, or the viewport ends somewhere between them.
    const scroller = installScroller(0);
    await mount(scroller);
    const first = rowWindow!.revealRow('r-50');
    const second = rowWindow!.revealRow('r-350');
    drainFrames(20);
    await Promise.all([first, second]);

    expect(scroller.scrollTop).toBe(soloTop);
  });

  test('a row growing above the viewport keeps the mounted window and the reader', async () => {
    // An expanded thinking block grows the row it sits in. The correction has
    // to land in the SAME commit as the measurement: a deferred restore runs
    // with the pre-measurement layout, so the next commit has no anchor left,
    // the window re-derives from a stale `scrollTop`, and the rows at its edge
    // unmount — measured in the browser as three rows removed and re-added per
    // expand, which throws away every block's local state (an expanded thought
    // snapping shut).
    const scroller = installScroller(20_000);
    const heights = new Map<string, number>();
    for (let i = 0; i < ROWS; i += 1) {
      const node = document.createElement('div');
      node.dataset.rowId = `r-${i}`;
      node.getBoundingClientRect = () => ({ height: heights.get(node.dataset.rowId!) ?? ROW_HEIGHT }) as DOMRect;
      scroller.appendChild(node);
    }
    await mount(scroller);
    await act(async () => {});
    const opened = rowWindow!.start;
    const before = scroller.scrollTop;
    expect(opened).toBeGreaterThan(0);

    heights.set('r-50', ROW_HEIGHT + 1_000);
    // What the timeline does on the click: a re-render, then the measure
    // effect adopts the grown row.
    await act(async () => { render(h(Probe, { node: scroller }), container); });
    drainFrames();
    await act(async () => {});

    expect(rowWindow!.start).toBe(opened);
    // The row the reader was on kept its place: the 1 000 px that appeared
    // above it moved the offset by exactly that much.
    expect(scroller.scrollTop).toBe(before + 1_000);
  });
});
