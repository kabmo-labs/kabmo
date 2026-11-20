/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The home page's DENSITY is a container fact, not a viewport fact.
 *
 * The first render drew three columns in a 268px right panel on a 1440px
 * window, because the breakpoint was `min-[420px]` — a media query on the
 * VIEWPORT. The panel is a resizable column whose width has nothing to do with
 * the window's, so the grid has to ask the CONTAINER.
 *
 * A DOM test cannot measure Tailwind, so what it pins is the contract the markup
 * must keep: the scroller declares `@container` and the grid's only breakpoint is
 * a container query. A future edit that swaps either back for `sm:`/`min-[…]`
 * fails here instead of on a screenshot.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { PanelHome } from '@/client/components/workspace/panel-tabs/Home';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
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
  render(null, container);
  container.remove();
});

function panel(id: string, label: string): ResolvedPanel {
  return {
    id,
    side: 'right',
    title: `${label} view`,
    label,
    name: '',
    builtin: true,
    requiresWorkspace: false,
    liveWhileHidden: false,
    minWidth: 200,
    defaultWidth: 268,
    defaultFraction: 0.28,
    render: () => null,
  };
}

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(
      h(PanelHome, {
        panels: [panel('files', 'Files'), panel('git', 'GIT')],
        openIds: new Set<string>(),
        onPick: () => {},
        title: 'Panel kanan',
      }),
      container,
    );
  });
  return container;
}

describe('PanelHome density', () => {
  test('the grid asks its CONTAINER, so a narrow panel never draws three columns', () => {
    const root = mount();
    const grid = root.querySelector('h2')?.parentElement?.querySelector('.grid');
    expect(grid).not.toBeNull();
    const classes = grid?.className ?? '';
    expect(classes).toContain('grid-cols-2');
    expect(classes).toContain('@[380px]:grid-cols-3');
    // A viewport breakpoint here would read the WINDOW's width, which is the
    // bug this test exists to keep out.
    expect(classes).not.toMatch(/(^|\s)(sm|md|lg|xl):/);
    expect(classes).not.toMatch(/min-\[\d+px\]:/);
  });

  test('the block is centred with `my-auto`, not `justify-center`', () => {
    const root = mount();
    const scroller = root.firstElementChild as HTMLElement;
    const block = scroller.firstElementChild as HTMLElement;
    // A flex column with `my-auto` centres while the content FITS and lets it
    // start at the top when it does not. `justify-center` on the scroller would
    // clip the heading above the viewport once the catalog overflows, which the
    // right column's twelve views do.
    expect(scroller.className).toContain('flex');
    expect(scroller.className).toContain('flex-col');
    expect(scroller.className).not.toContain('justify-center');
    expect(block.className).toContain('my-auto');
  });

  test('the scroll container is the query container the grid measures against', () => {
    const root = mount();
    const scroller = root.firstElementChild as HTMLElement | null;
    expect(scroller?.className).toContain('@container');
    expect(scroller?.className).toContain('overflow-y-auto');
  });
});
