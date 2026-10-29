/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Composer growth: `useAutoGrow` sizes a modal composer to its content under a
 * ceiling. Both of its rules are invisible without measuring: the box must be
 * collapsed to `auto` BEFORE `scrollHeight` is read (with its old height in
 * place, `scrollHeight` reports the box's own size and a deletion could never
 * bring it back down), and the result must be clamped between the floor and
 * the ceiling so a pasted transcript cannot push the send button off screen.
 *
 * Split verbatim from `pipeline.test.ts` so both files stay under the repo's
 * 350-line ceiling; the attach-and-send pipeline keeps its own file.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useAutoGrow } from '@/client/hooks/chat/composer/auto-grow';

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'getComputedStyle', 'File', 'Blob', 'FileReader', 'URL', 'FormData',
] as const;

let container: HTMLElement;

/** The runner's own globals, put back once this file's DOM work is done. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

// ── useAutoGrow ─────────────────────────────────────────────────────────────

interface Measured {
  /** The inline height at each `scrollHeight` read, in order. */
  heights: string[];
  scrollHeight: number;
}

function GrowProbe({ value, min, max, maxLines, enabled, measured }: {
  value: string;
  min: number;
  max?: number;
  maxLines?: number;
  enabled?: boolean;
  measured: Measured;
}) {
  const ref = useAutoGrow({ value, minHeightPx: min, maxHeightPx: max, maxLines, enabled });
  return h('textarea', {
    ref: (el: HTMLTextAreaElement | null) => {
      if (!el) return;
      (ref as { current: HTMLTextAreaElement | null }).current = el;
      if (Object.getOwnPropertyDescriptor(el, 'scrollHeight')) return;
      Object.defineProperty(el, 'scrollHeight', {
        configurable: true,
        get: () => {
          measured.heights.push(el.style.height);
          return measured.scrollHeight;
        },
      });
    },
  });
}

function box(scrollHeight: number): Measured {
  return { heights: [], scrollHeight };
}

async function mountGrow(
  measured: Measured,
  value: string,
  min: number,
  max?: number,
  options: { maxLines?: number; enabled?: boolean } = {},
) {
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(GrowProbe, { value, min, max, measured, ...options }), container);
  });
  return container.querySelector('textarea') as HTMLTextAreaElement;
}

describe('useAutoGrow', () => {
  test('content under the ceiling sets the height it needs', async () => {
    const measured = box(200);
    const el = await mountGrow(measured, 'two lines', 80, 480);
    expect(el.style.height).toBe('200px');
    expect(el.style.overflowY).toBe('hidden');
  });

  test('a paste past the ceiling stops there and scrolls', async () => {
    const measured = box(900);
    const el = await mountGrow(measured, 'a very long paste', 80, 480);
    expect(el.style.height).toBe('480px');
    expect(el.style.overflowY).toBe('auto');
  });

  test('an empty box never shrinks below its floor', async () => {
    const measured = box(12);
    const el = await mountGrow(measured, '', 80, 480);
    expect(el.style.height).toBe('80px');
    expect(el.style.overflowY).toBe('hidden');
  });

  test('the box is collapsed before each measurement, so a deletion can shrink it', async () => {
    const measured = box(900);
    const el = await mountGrow(measured, 'long', 80, 480);
    // The effect reads `scrollHeight` twice: the first read is the one that
    // decides the height and it MUST see the collapsed box, never the previous
    // pixel height. The second is the overflow check, after the height landed.
    expect(measured.heights).toEqual(['auto', '480px']);
    expect(el.style.height).toBe('480px');

    measured.scrollHeight = 120;
    await act(async () => { render(h(GrowProbe, { value: 'short', min: 80, max: 480, measured }), container); });
    expect(measured.heights).toEqual(['auto', '480px', 'auto', '120px']);
    expect(el.style.height).toBe('120px');
    expect(el.style.overflowY).toBe('hidden');
  });

  test('raising the floor re-measures with the new minimum', async () => {
    const measured = box(50);
    await mountGrow(measured, 'x', 80, 480);
    await act(async () => { render(h(GrowProbe, { value: 'x', min: 120, max: 480, measured }), container); });
    const el = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(el.style.height).toBe('120px');
  });
});

/**
 * The chat's docked composer states its ceiling in LINES, not px: the same
 * textarea renders at 13px on every platform except iOS, which forces 16px so
 * Safari does not zoom the page. A px cap would therefore be a different number
 * of lines on each, and the ceiling exists precisely to bound the box by lines.
 */
describe('useAutoGrow line ceiling', () => {
  test('a line count is resolved against the element’s own line box', async () => {
    // happy-dom reports the initial `line-height: normal` / `font-size: 16px`
    // and no padding, so seven lines are 7 × 16 × 1.5 = 168px.
    const el = await mountGrow(box(900), 'a long draft', 0, undefined, { maxLines: 7 });
    expect(el.style.height).toBe('168px');
    expect(el.style.overflowY).toBe('auto');
  });

  test('content under the line ceiling keeps its own height', async () => {
    const el = await mountGrow(box(100), 'three lines', 0, undefined, { maxLines: 7 });
    expect(el.style.height).toBe('100px');
    expect(el.style.overflowY).toBe('hidden');
  });
});

/**
 * A stretched composer is sized by its layout (`h-full` on a phone, a share of
 * the viewport on a desktop), so the hook must hand the height back instead of
 * measuring over it — and must do so the moment the stretch starts, or the
 * docked inline height would pin the box at its docked size.
 */
describe('useAutoGrow disabled', () => {
  test('clears the inline height and stops measuring', async () => {
    const measured = box(900);
    const el = await mountGrow(measured, 'long', 80, 480);
    expect(el.style.height).toBe('480px');

    measured.heights.length = 0;
    await act(async () => {
      render(h(GrowProbe, { value: 'long', min: 80, max: 480, measured, enabled: false }), container);
    });
    expect(el.style.height).toBe('');
    expect(el.style.overflowY).toBe('');
    expect(measured.heights).toEqual([]);
  });
});
