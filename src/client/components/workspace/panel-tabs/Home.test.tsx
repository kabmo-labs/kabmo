/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The home page: the catalog as cards, with the duplicate-tab rule stated where
 * the user is most likely to break it.
 *
 * Two properties matter and both are visible state, not implementation:
 *
 * - a view that is already open is marked `aria-pressed` and its card SAYS so,
 *   so the grid is never a list of identical buttons;
 * - pressing it still calls `onPick` — the host focuses the existing tab. A
 *   `disabled` card would be unable to explain itself, which is the reason the
 *   harness tabs stopped using the native attribute (measured: a disabled
 *   button never shows its `title`).
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

const PANELS = [panel('files', 'Files'), panel('git', 'GIT'), panel('todo', 'Todos')];

function mount(openIds: string[]) {
  const picked: string[] = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(
      h(PanelHome, {
        panels: PANELS,
        openIds: new Set(openIds),
        onPick: (id: string) => picked.push(id),
        title: 'Panel kanan',
      }),
      container,
    );
  });
  return picked;
}

describe('PanelHome', () => {
  test('one card per catalog entry, with the catalog label and title', () => {
    mount([]);
    const cards = container.querySelectorAll('[aria-pressed]');
    expect(cards).toHaveLength(3);
    expect(cards[0]?.textContent).toContain('Files');
    expect(cards[1]?.textContent).toContain('GIT');
  });

  test('a view with no tab is not pressed, and its card offers to open it', () => {
    mount([]);
    const first = container.querySelector('[aria-pressed]') as HTMLElement;
    expect(first.getAttribute('aria-pressed')).toBe('false');
    expect(first.getAttribute('aria-label')).toBe('Buka Files view');
  });

  test('a view that is already open is pressed and says so on the card', () => {
    mount(['files']);
    const first = container.querySelector('[aria-pressed]') as HTMLElement;
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(first.textContent).toContain('Sudah terbuka');
    expect(first.getAttribute('aria-label')).toContain('sudah terbuka');
  });

  test('pressing an OPEN card still calls onPick, so the host focuses its tab', () => {
    const picked = mount(['files']);
    const first = container.querySelector('[aria-pressed]') as HTMLElement;
    act(() => first.click());
    expect(picked).toEqual(['files']);
  });

  test('pressing a closed card asks for that view once', () => {
    const picked = mount(['files']);
    const cards = container.querySelectorAll('[aria-pressed]');
    act(() => (cards[1] as HTMLElement).click());
    expect(picked).toEqual(['git']);
  });

  test('an empty catalog says so instead of drawing an empty grid', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(h(PanelHome, { panels: [], openIds: new Set<string>(), onPick: () => {}, title: 'Panel kiri' }), container);
    });
    expect(container.textContent).toContain('Tidak ada view');
  });
});
