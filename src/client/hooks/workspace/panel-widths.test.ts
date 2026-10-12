/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desktop layout's width math, and the two hooks that feed it.
 *
 * `resolvePanelWidth` is the only place a remembered width becomes pixels, and
 * its ceiling is DYNAMIC — `available − chat floor − the sibling's reserved
 * width − handles` — because a fixed ceiling either wastes a large monitor or
 * eats the conversation on a small one. The cases below pin that cap on a
 * narrow and a wide group, the no-measurement fallback (px, never zero), and
 * that a px-only remembered width is honoured as written.
 *
 * `usePanelWidths` owns one slot per panel, so a drag on the sidebar must not
 * reset the editor or the right panel, and a right-panel switch must keep every
 * other view's width. A session that has never been resized starts EMPTY — no
 * global seed — so every panel opens at its own default fraction.
 * `useAvailableWidth` reports `null` until measured — a zero here would
 * collapse a panel on its first render.
 *
 * Rendered with `h()` (no JSX) against happy-dom; the layout modules are
 * imported statically, as `git-status.test.ts` does.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { useAvailableWidth } from '@/client/hooks/workspace/available-width';
import { usePanelWidths } from '@/client/hooks/workspace/panel-widths';
import { SessionStateContext } from '@/client/hooks/workspace/session-state/context';
import {
  DEFAULT_EDITOR_WIDTHS,
  MIN_EDITOR_PANEL_WIDTH,
  resolvePanelWidth,
  type PanelWidths,
} from '@/shared/lib/workspace/panel-widths';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
/** The runner's own fetch, put back on teardown — deleting it strips the global every later file needs. *//** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

let container: HTMLElement;
const sessions: string[] = [];
let sessionCounter = 0;

/** A ResizeObserver the test drives by hand, so no real layout is needed. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
}

/** The last measured width the hook reported. */
let measured: number | null = null;

function WidthProbe() {
  const ref = useRef<HTMLDivElement>(null);
  measured = useAvailableWidth(ref);
  return h('div', { ref });
}

/** The live panel-widths handle, re-read after every render. */
let panels: { widths: PanelWidths; commitWidths: (patch: PanelWidths) => void } | null = null;

function PanelProbe() {
  panels = usePanelWidths();
  return null;
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.ResizeObserver = FakeResizeObserver;
  target.fetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  delete target.ResizeObserver;
  if (nativeFetch) target.fetch = nativeFetch;
  else delete target.fetch;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  for (const id of sessions) forgetSession(id);
  sessions.length = 0;
  FakeResizeObserver.instances.length = 0;
  measured = null;
  panels = null;
});

function mount(node: unknown) {
  container = document.createElement('div');
  document.body.appendChild(container);
  return act(async () => {
    render(node as never, container as HTMLElement);
  });
}

function mountPanels() {
  const sessionId = `panel-widths-${++sessionCounter}`;
  sessions.push(sessionId);
  return mount(h(SessionStateContext.Provider, { value: { sessionId, ready: true }, children: h(PanelProbe, {}) }));
}

/** Set the measured width and drive the observer the way a resize would. */
function resizeTo(width: number) {
  const element = container?.firstElementChild;
  Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
  return act(async () => {
    FakeResizeObserver.instances.at(-1)?.callback();
  });
}

describe('resolvePanelWidth', () => {
  test('a narrow group caps the panel at its floor, not a fixed number', () => {
    // 1000 − 400 chat − 280 sibling − 3 handle = 317, below the 320 floor.
    const width = resolvePanelWidth({
      defaultFraction: 0.6,
      defaultPx: 600,
      available: 1000,
      min: MIN_EDITOR_PANEL_WIDTH,
      siblingWidth: 280,
      handleCount: 1,
    });
    expect(width).toBe(320);
  });

  test('a wide group grants the fraction share when the budget allows it', () => {
    // 3000 − 400 − 280 − 3 = 2317, well above 0.6 × 3000 = 1800.
    const width = resolvePanelWidth({
      defaultFraction: 0.6,
      defaultPx: 600,
      available: 3000,
      min: MIN_EDITOR_PANEL_WIDTH,
      siblingWidth: 280,
      handleCount: 1,
    });
    expect(width).toBe(1800);
  });

  test('a remembered fraction is still clamped by the panel ceiling', () => {
    const width = resolvePanelWidth({
      stored: { fraction: 0.9 },
      defaultFraction: 0.6,
      defaultPx: 600,
      available: 2000,
      min: MIN_EDITOR_PANEL_WIDTH,
      siblingWidth: 280,
      handleCount: 1,
    });
    // 0.9 × 2000 = 1800 would eat the chat; the panel's own cap (0.6 × 2000 =
    // 1200) is tighter than the group budget (2000 − 400 − 280 − 3 = 1317).
    expect(width).toBe(1200);
  });

  test('without a measurement the stored px is used, floored at min', () => {
    expect(
      resolvePanelWidth({ stored: { px: 900 }, defaultFraction: 0.6, defaultPx: 600, available: null, min: 320, siblingWidth: 280, handleCount: 1 }),
    ).toBe(900);
    expect(
      resolvePanelWidth({ stored: { px: 100 }, defaultFraction: 0.6, defaultPx: 600, available: 0, min: 320, siblingWidth: 280, handleCount: 1 }),
    ).toBe(320);
    expect(
      resolvePanelWidth({ defaultFraction: 0.4, defaultPx: DEFAULT_EDITOR_WIDTHS.editor, available: null, min: MIN_EDITOR_PANEL_WIDTH, siblingWidth: 280, handleCount: 1 }),
    ).toBe(DEFAULT_EDITOR_WIDTHS.editor);
  });

  test('a px-only remembered width is honoured as written, not rescaled', () => {
    const width = resolvePanelWidth({
      stored: { px: 900 },
      defaultFraction: 0.6,
      defaultPx: 600,
      available: 2000,
      min: 320,
      siblingWidth: 280,
      handleCount: 1,
    });
    expect(width).toBe(900);
  });
});

describe('useAvailableWidth', () => {
  test('reports null until measured, and null again when the group has no width', async () => {
    await mount(h(WidthProbe, {}));
    expect(measured).toBeNull();

    await resizeTo(800);
    expect(measured).toBe(800);

    await resizeTo(0);
    expect(measured).toBeNull();
  });

  test('disconnects the observer on unmount', async () => {
    await mount(h(WidthProbe, {}));
    const observer = FakeResizeObserver.instances.at(-1);
    render(null, container as HTMLElement);
    expect(observer?.disconnected).toBe(true);
  });
});

describe('usePanelWidths', () => {
  test('a session that has never been resized starts empty, so panels open at their defaults', async () => {
    // The regression this pins: a former global seed carried a stale value into
    // every new session and pinned its editor to the floor. A new session must
    // resolve every panel from its own default fraction, not from a global map.
    await mountPanels();
    expect(panels?.widths).toEqual({});
  });

  test('each panel owns its slot: a commit never resets another panel', async () => {
    await mountPanels();
    await act(async () => panels?.commitWidths({ editor: { fraction: 0.5 } }));
    await act(async () => panels?.commitWidths({ right: { git: { px: 460 } } }));
    await act(async () => panels?.commitWidths({ diff: { px: 900 } }));

    expect(panels?.widths.editor).toEqual({ fraction: 0.5 });
    expect(panels?.widths.right?.git).toEqual({ px: 460 });
    expect(panels?.widths.diff).toEqual({ px: 900 });
  });

  test('switching the right-panel view keeps the other views widths', async () => {
    await mountPanels();
    await act(async () => panels?.commitWidths({ right: { git: { px: 460 } } }));
    await act(async () => panels?.commitWidths({ right: { files: { px: 520 } } }));

    expect(panels?.widths.right?.git).toEqual({ px: 460 });
    expect(panels?.widths.right?.files).toEqual({ px: 520 });
  });

  test('a fraction patch keeps the px fallback it was derived from', async () => {
    await mountPanels();
    await act(async () => panels?.commitWidths({ editor: { px: 640 } }));
    await act(async () => panels?.commitWidths({ editor: { fraction: 0.7 } }));
    expect(panels?.widths.editor).toEqual({ px: 640, fraction: 0.7 });
  });
});
