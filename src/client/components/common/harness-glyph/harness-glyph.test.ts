/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness mark every session row draws before its name.
 *
 * Three properties are load-bearing and none of them is visual:
 *
 *  - an UNKNOWN harness renders nothing, because a generic mark would claim a
 *    session runs on an agent this build cannot name;
 *  - the mark is DECORATIVE for assistive tech — it carries `role="img"` with
 *    the harness's own label, so a row reads "claude" rather than "orbit";
 *  - both row densities take their size from one constant, so a phone row and a
 *    desktop row cannot disagree about the glyph.
 *
 * Rendered with `h()` against happy-dom, following `SessionItem.test.ts`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { HarnessGlyph, HARNESS_GLYPH_SIZE } from '@/client/components/common/harness-glyph';
import { HARNESS_CATALOG, HARNESS_IDS, harnessBadgeLabel, harnessDescriptor } from '@/shared/lib/harness/catalog';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

async function mount(harness: string | null | undefined, size?: number) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(HarnessGlyph, { harness, ...(size === undefined ? {} : { size }) }), container);
  });
  return container;
}

describe('harness glyph', () => {
  test('draws one labelled svg for a known harness', async () => {
    const el = await mount('claude');
    const mark = el.querySelector('[role="img"]');
    expect(mark?.getAttribute('aria-label')).toBe('claude');
    expect(mark?.getAttribute('data-harness')).toBe('claude');
    expect(mark?.querySelector('svg')).not.toBeNull();
  });

  test('tells the two omp surfaces apart by word, not by glyph', async () => {
    const rpc = await mount('omp-rpc');
    expect(rpc.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('omp');
    const acp = await mount('omp-acp');
    expect(acp.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('omp (ACP)');
  });

  test('renders nothing for an unknown harness rather than a generic mark', async () => {
    const el = await mount('some-future-agent');
    expect(el.querySelector('svg')).toBeNull();
    expect(el.textContent).toBe('');
  });

  test('renders nothing when the session carries no harness at all', async () => {
    for (const value of [undefined, null, '']) {
      const el = await mount(value);
      expect(el.querySelector('svg')).toBeNull();
    }
  });

  test('the size argument reaches the svg, and both densities have a size', async () => {
    const el = await mount('codex', HARNESS_GLYPH_SIZE.touch);
    const svg = el.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe(String(HARNESS_GLYPH_SIZE.touch));
    expect(HARNESS_GLYPH_SIZE.compact).toBeLessThan(HARNESS_GLYPH_SIZE.touch);
    // The composer's tab strip is a PRIMARY control: its mark is larger than a
    // session row's, and its own size rather than a reuse of `touch`, so growing
    // the sidebar can never silently shrink the tabs.
    expect(HARNESS_GLYPH_SIZE.tab).toBeGreaterThan(HARNESS_GLYPH_SIZE.touch);
  });
});

describe('brand art', () => {
  test('every catalog glyph names brand art that actually renders', async () => {
    // A catalog entry pointing at a missing brand key would draw an empty box
    // in the sidebar and the tab strip, which is exactly this pin.
    for (const id of HARNESS_IDS) {
      const el = await mount(id);
      const svg = el.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.querySelectorAll('path').length).toBeGreaterThan(0);
    }
  });

  test('every mark is cropped to its own ink, so one size means one size', async () => {
    // The source viewport is not the mark: omp fills 62.5% of its 64x64 box,
    // codex all of its 24x24. Drawing both at one `size` made the omp tab read
    // smaller than its neighbour (11px of ink beside 18px freehand), so the
    // viewBox is the measured ink box instead.
    const omp = await mount('omp-rpc');
    expect(omp.querySelector('svg')?.getAttribute('viewBox')).toBe('14 16 36 40');
    const claude = await mount('claude');
    expect(claude.querySelector('svg')?.getAttribute('viewBox')).toBe('0 5 24 15');
    // A mark that fills its box keeps the whole box — the crop is per brand.
    const codex = await mount('codex');
    expect(codex.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  test('no source plate or gradient survives into the DOM', async () => {
    // The marks are painted in `currentColor`; a leftover `<rect fill>` or
    // `linearGradient` would be the only chroma in the densest list in the app.
    for (const id of HARNESS_IDS) {
      const el = await mount(id);
      expect(el.querySelector('linearGradient')).toBeNull();
      expect(el.querySelector('rect')).toBeNull();
      expect(el.querySelector('[fill^="#"]')).toBeNull();
    }
  });

  test('the two omp surfaces share one mark but keep their own name', async () => {
    const rpc = await mount('omp-rpc');
    const acp = await mount('omp-acp');
    expect(rpc.querySelector('svg')?.innerHTML).toBe(acp.querySelector('svg')?.innerHTML);
    expect(rpc.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('omp');
    expect(acp.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('omp (ACP)');
  });

  test('the svg carries the HARNESS id, not only the brand key it shares', async () => {
    // `data-harness` is the brand (`omp` for both transports) and therefore cannot
    // colour them apart; `data-harness-id` is what the per-surface paint rule
    // keys on, so it has to reach the element the paint rule selects.
    const rpc = await mount('omp-rpc');
    expect(rpc.querySelector('svg')?.getAttribute('data-harness')).toBe('omp');
    expect(rpc.querySelector('svg')?.getAttribute('data-harness-id')).toBe('omp-rpc');
    const acp = await mount('omp-acp');
    expect(acp.querySelector('svg')?.getAttribute('data-harness')).toBe('omp');
    expect(acp.querySelector('svg')?.getAttribute('data-harness-id')).toBe('omp-acp');
  });
});

describe('harness catalog', () => {
  test('every listed id resolves to itself', () => {
    for (const id of HARNESS_IDS) {
      expect(harnessDescriptor(id)?.id).toBe(id);
      expect(HARNESS_CATALOG[id].label.length).toBeGreaterThan(0);
    }
  });

  test('every glyph key names a mark the component can draw', async () => {
    // A catalog entry whose glyph has no table row would render an empty box in
    // the sidebar, which is exactly the failure this pins.
    for (const id of HARNESS_IDS) {
      const el = await mount(id);
      expect(el.querySelector('svg')).not.toBeNull();
    }
  });

  test('an unknown id is named, never silently blank', () => {
    expect(harnessBadgeLabel('some-future-agent')).toBe('unknown harness');
    expect(harnessBadgeLabel(null)).toBe('unknown harness');
  });
});
