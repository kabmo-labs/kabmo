/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A separator drag must persist the width it actually landed.
 *
 * `useSeparatorDrag`'s `onUp` lands the final size and then builds the layout it
 * reports from every panel's `getSize()` — in the SAME tick, with no render in
 * between. A `getSize` that reads a value only a render writes therefore reports
 * the size the panel had BEFORE the drag, and the commit persists the wrong
 * width: measured in the browser, a sidebar dragged 351 → 446 posted
 * `omp_sidebar_width: 351`, so the drag looked like it never saved.
 *
 * Driven through real pointer events on the separator, because that IS the path
 * under test — the imperative `resize()` is not what a drag calls.
 *
 * Rendered with `h()` (no JSX) against happy-dom.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Group, Panel, Separator, type LayoutChangedHandler } from '@/client/components/layout/desktop-layout/resizer';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
/** Every layout the group committed, in order. */
let layouts: Array<Record<string, number>> = [];

function Probe() {
  return h(Group, {
    orientation: 'horizontal',
    onLayoutChanged: ((layout) => layouts.push(layout)) as LayoutChangedHandler,
    children: [
      h(Panel, { id: 'probe', defaultSize: 300, minSize: 100, maxSize: 600, children: h('div', null, 'panel') }),
      h(Separator, {}),
      // The filler is the panel a drag transfers into, so it needs a measured
      // width of its own — happy-dom lays nothing out, and a 0-width filler clamps
      // every delta to zero in `transfer`.
      h(Panel, { id: 'filler', filler: true, children: h('div', null, 'fill') }),
    ],
  });
}

/**
 * happy-dom lays nothing out, so `getBoundingClientRect` answers zeros. The drag
 * measures its neighbours with it, so each panel's rect is derived from the
 * width `Panel` actually rendered — which is also what makes the assertion
 * meaningful: the reported layout must agree with the DOM. The filler has no
 * inline width (flexbox sizes it), so it is given the rest of a 900px group.
 */
function stubLayout(): void {
  for (const el of container.querySelectorAll<HTMLElement>('[data-panel-id]')) {
    el.getBoundingClientRect = () => {
      const own = Number.parseFloat(el.style.width || '0') || 0;
      const width = el.getAttribute('data-panel-id') === 'filler' ? 900 - widthOf('probe') : own;
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
  }
}

function widthOf(id: string): number {
  const el = container.querySelector<HTMLElement>(`[data-panel-id="${id}"]`);
  return el ? Number.parseFloat(el.style.width || '0') || 0 : 0;
}

/** Dispatch a pointer event with the fields the drag reads. */
function pointer(type: string, clientX: number): void {
  const event = new Event(type, { bubbles: true }) as Event & { clientX: number; button: number };
  event.clientX = clientX;
  event.button = 0;
  const target = type === 'pointerdown' ? container.querySelector('[data-separator]') : window;
  target?.dispatchEvent(event);
}

async function dragBy(delta: number): Promise<void> {
  await act(async () => {
    pointer('pointerdown', 300);
  });
  await act(async () => {
    pointer('pointermove', 300 + delta);
  });
  await act(async () => {
    pointer('pointerup', 300 + delta);
  });
}

afterAll(() => {
  restoreDomGlobals();
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  layouts = [];
});

async function mount() {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Probe, {}), container);
  });
  stubLayout();
}

describe('separator drag commit', () => {
  test('the reported layout is the width the panel rendered, not the pre-drag one', async () => {
    await mount();
    expect(widthOf('probe')).toBe(300);

    await dragBy(146);

    expect(widthOf('probe')).toBe(446);
    const committed = layouts.at(-1);
    // The regression: a `getSize` reading a render-written ref answered 300 here
    // while the DOM already showed 446, and that 300 is what got persisted.
    expect(committed?.probe).toBe(446);
    expect(committed?.probe).toBe(widthOf('probe'));
  });

  test('a shrinking drag reports the shrunken width', async () => {
    await mount();
    await dragBy(-120);

    expect(widthOf('probe')).toBe(180);
    expect(layouts.at(-1)?.probe).toBe(180);
  });

  test('the drag still clamps at the panel constraints', async () => {
    await mount();
    await dragBy(2000);
    expect(layouts.at(-1)?.probe).toBe(600);

    await dragBy(-2000);
    expect(layouts.at(-1)?.probe).toBe(100);
    expect(widthOf('probe')).toBe(100);
  });
});
