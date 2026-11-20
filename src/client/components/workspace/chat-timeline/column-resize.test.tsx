/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Dragging the chat column's edge.
 *
 * Three facts are pinned, each one a way the gesture can look right and be
 * wrong:
 *
 * - **centred column → twice the delta.** The column is `margin-inline: auto`,
 *   so both edges move: a 100px pointer move is a 200px column. A drag that used
 *   the raw delta moved the edge at half the pointer's speed (this was the
 *   first implementation, and it is why the factor is asserted, not assumed).
 * - **nothing is stored until the release.** A `pointermove` paints; only
 *   `pointerup` writes. Any per-move write was dozens of settings POSTs for a
 *   width the user was still choosing.
 * - **an abandoned gesture stores nothing.** `pointercancel` (and a plain click
 *   on the grip, which never moves) must leave the stored preset intact and
 *   drop the live preview, or a cancelled drag would pin the column to
 *   `custom` on the next reload.
 *
 * Driven through real pointer events on the grip, because that IS the path
 * under test — `useColumnDrag`'s handlers are not called directly.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { ColumnResizeHandle } from '@/client/components/workspace/chat-timeline/ColumnResizeHandle';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { primeKabmoSettings, readKabmoSetting } from '@/shared/lib/settings/client';
import { readSettingsBlob } from '@/shared/lib/settings/keys';
import { applyChatWidthMode } from '@/client/hooks/chat/timeline/width-mode';
import { CHAT_COLUMN_MAX_VAR, CHAT_WIDTH_ATTRIBUTE, MIN_CHAT_COLUMN_WIDTH } from '@/shared/lib/chat/timeline/width-mode';

let container: HTMLElement;
let surface: HTMLElement;
let column: HTMLElement;
let posts: Record<string, unknown>[] = [];
const nativeFetch = Bun.fetch;

/** A surface that centres a 970px column, and the grip inside it. */
const COLUMN_WIDTH = 970;
const SURFACE_WIDTH = 1400;
const PADDING = 16;

/**
 * `ResizeObserver` the test drives by hand: the handle measures once on mount
 * and then on every observation, and happy-dom lays nothing out — so the stub's
 * callback is how a case says "the column is now this wide".
 */
class StubResizeObserver {
  static latest: StubResizeObserver | null = null;
  readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    StubResizeObserver.latest = this;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  const target = globalThis as unknown as Record<string, unknown>;
  // Both are read through the BARE global, which happy-dom only provides on the
  // window it installed.
  target.getComputedStyle = window.getComputedStyle.bind(window);
  target.ResizeObserver = StubResizeObserver;
});

afterAll(() => {
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
  restoreDomGlobals();
});

beforeEach(() => {
  posts = [];
  (globalThis as unknown as Record<string, unknown>).fetch = (async (_input: unknown, init?: RequestInit) => {
    posts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return Response.json({ success: true });
  }) as unknown as typeof fetch;
  primeKabmoSettings({});

  container = document.createElement('div');
  document.body.appendChild(container);

  act(() => {
    render(
      h('div', {
        // `relative` + padding: the shape both mounting surfaces have.
        className: 'relative p-4',
        children: [
          h('div', { className: 'chat-column', children: h('div', { id: 'row' }, 'hello') }),
          h(ColumnResizeHandle, { isMobile: false }),
        ],
      }),
      container,
    );
  });

  surface = container.firstElementChild as HTMLElement;
  column = surface.querySelector<HTMLElement>('.chat-column')!;
  // Inline, because happy-dom has no stylesheet: the drag and the handle both
  // read the padding OFF the computed style, and a Tailwind class resolves to
  // nothing here.
  surface.style.padding = `${PADDING}px`;
  stubGeometry();
  // The handle measured itself on mount, before the rects existed.
  remeasure();
});

afterEach(() => {
  render(null, container);
  container.remove();
  primeKabmoSettings({});
  const root = document.documentElement;
  root.removeAttribute(CHAT_WIDTH_ATTRIBUTE);
  root.style.removeProperty(CHAT_COLUMN_MAX_VAR);
});

/**
 * happy-dom lays nothing out, so every rect is a zero. The drag measures the
 * column and its parent's content box, and the handle measures the same two —
 * both are stubbed from ONE source here, so the numbers the gesture computes are
 * the numbers a browser would give it.
 */
function stubGeometry(): void {
  surface.getBoundingClientRect = () =>
    ({ width: SURFACE_WIDTH, height: 800, top: 0, left: 0, right: SURFACE_WIDTH, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(surface, 'clientWidth', { get: () => SURFACE_WIDTH, configurable: true });
  Object.defineProperty(column, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: currentWidth(),
      height: 800,
      top: 0,
      left: (SURFACE_WIDTH - currentWidth()) / 2,
      right: (SURFACE_WIDTH + currentWidth()) / 2,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

/** Re-run the handle's measurement now that the rects are stubbed. */
function remeasure(): void {
  act(() => {
    StubResizeObserver.latest?.callback();
  });
}

/** The width the document currently asks for, as the stub reports it. */
function currentWidth(): number {
  const custom = document.documentElement.style.getPropertyValue(CHAT_COLUMN_MAX_VAR);
  if (custom) return Number.parseFloat(custom) || MIN_CHAT_COLUMN_WIDTH;
  return COLUMN_WIDTH;
}

function grip(): HTMLElement {
  const element = surface.querySelector<HTMLElement>('[data-chat-column-grip]');
  if (!element) throw new Error('no grip');
  return element;
}

async function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', clientX: number): Promise<void> {
  await act(async () => {
    // The drag listens on `window` for moves and on the grip for the start.
    // happy-dom's window IS the global here, so one target covers both.
    const target = type === 'pointerdown' ? grip() : window;
    target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, button: 0, clientX }));
  });
  // The live preview is coalesced to one per frame; let that frame run.
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 20);
    await promise;
  });
}

const previewWidth = () =>
  Number.parseFloat(document.documentElement.style.getPropertyValue(CHAT_COLUMN_MAX_VAR) || '0');

describe('the column edge drag', () => {
  test('the column moves twice the pointer delta, because it is centred', async () => {
    await pointer('pointerdown', 700);
    await pointer('pointermove', 800);
    await pointer('pointerup', 800);

    // Half of the surface is 700 wide under padding; the clamp is the surface's
    // content box, so the widest legal column here is 1368.
    expect(previewWidth()).toBe(COLUMN_WIDTH + 200);
    expect(readKabmoSetting('chatWidthMode')).toBe('custom');
    expect(readKabmoSetting('chatColumnWidth')).toBe(COLUMN_WIDTH + 200);
  });

  test('a move paints and stores nothing; the release is the one write', async () => {
    await pointer('pointerdown', 700);
    await pointer('pointermove', 760);
    expect(previewWidth()).toBe(COLUMN_WIDTH + 120);
    expect(posts).toHaveLength(0);
    expect(readKabmoSetting('chatWidthMode')).toBeUndefined();

    await pointer('pointerup', 760);
    expect(posts).toHaveLength(1);
    const blob = readSettingsBlob(posts[0]);
    expect(blob.chatWidthMode).toBe('custom');
    expect(blob.chatColumnWidth).toBe(COLUMN_WIDTH + 120);
  });

  test('a cancelled gesture drops the preview and keeps the stored preset', async () => {
    primeKabmoSettings({ chatWidthMode: 'compact' });
    await pointer('pointerdown', 700);
    await pointer('pointermove', 900);
    expect(previewWidth()).toBeGreaterThan(COLUMN_WIDTH);

    await pointer('pointercancel', 900);
    expect(posts).toHaveLength(0);
    expect(document.documentElement.style.getPropertyValue(CHAT_COLUMN_MAX_VAR)).toBe('');
    expect(readKabmoSetting('chatWidthMode')).toBe('compact');
  });

  test('a click that never moves stores nothing and switches no mode', async () => {
    primeKabmoSettings({ chatWidthMode: 'wide' });
    await pointer('pointerdown', 700);
    await pointer('pointerup', 700);
    expect(posts).toHaveLength(0);
    // The stored preset is untouched: still the one primed before the click.
    expect(readKabmoSetting('chatWidthMode')).toBe('wide');
  });

  test('the drag cannot narrow past the reading floor', async () => {
    await pointer('pointerdown', 700);
    await pointer('pointermove', 100);
    await pointer('pointerup', 100);
    expect(readKabmoSetting('chatColumnWidth')).toBe(MIN_CHAT_COLUMN_WIDTH);
  });

  test('the drag cannot widen past the surface it is drawn in', async () => {
    await pointer('pointerdown', 700);
    await pointer('pointermove', 5000);
    await pointer('pointerup', 5000);
    // The content box: the surface's 1400 minus its own 16px padding a side.
    expect(readKabmoSetting('chatColumnWidth')).toBe(SURFACE_WIDTH - PADDING * 2);
  });
});

describe('the grip itself', () => {
  test('is a labelled separator with no painted line', () => {
    const element = grip();
    expect(element.getAttribute('role')).toBe('separator');
    expect(element.getAttribute('aria-label')).toBe('Resize chat column');
    // The affordance is the cursor, not a drawn hairline.
    expect(element.className).toContain('cursor-col-resize');
    expect(element.className).not.toContain('border');
    expect(element.className).not.toContain('bg-');
  });

  test('hangs in the centring gap, ending at the measured column edge', () => {
    // The gap is (1400 − 970) / 2 = 215; the 12px strip occupies its last 12px,
    // so it sits just outside the column rather than over what the column draws.
    const gap = (SURFACE_WIDTH - COLUMN_WIDTH) / 2;
    expect(grip().style.right).toBe(`${gap - 12}px`);
    expect(grip().className).toContain('w-3');
  });

  test('follows the column when it changes size', () => {
    applyChatWidthMode('custom', 1200);
    remeasure();
    expect(grip().style.right).toBe(`${(SURFACE_WIDTH - 1200) / 2 - 12}px`);
    expect(grip().getAttribute('aria-valuenow')).toBe('1200');
  });

  test('a phone draws no grip — the column already fills the screen', () => {
    render(null, container);
    act(() => {
      render(
        h('div', { className: 'relative p-4', children: [h('div', { className: 'chat-column' }), h(ColumnResizeHandle, { isMobile: true })] }),
        container,
      );
    });
    const element = container.querySelector<HTMLElement>('[data-chat-column-grip]');
    expect(element?.className).toContain('hidden');
  });
});
