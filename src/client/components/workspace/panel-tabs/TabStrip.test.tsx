/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The desktop tab strip and the column that hosts it.
 *
 * Three properties, and each is a rule the strip exists to keep:
 *
 * - **the add control opens the CATALOG, not a blank chip.** A strip that
 *   appended an unnamed tab would be a tab nobody can identify or close;
 * - **a card the user already opened focuses its tab** instead of appending a
 *   second one — the duplicate-tab failure a card grid invites;
 * - **the pinned view has no close control**, because a column with no way back
 *   to its own view is a dead end.
 *
 * Rendered with `h()` against happy-dom; the strip is pure props, so no kit
 * services are needed.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { PanelTabStrip } from '@/client/components/workspace/panel-tabs/TabStrip';
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
    title: `${label} — title`,
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

const FILES = panel('files', 'Files');
const GIT = panel('git', 'GIT');
const SESSIONS = panel('sessions', 'Sessions');

function mount(props: Partial<Parameters<typeof PanelTabStrip>[0]> = {}) {
  const calls = { add: 0, select: [] as string[], close: [] as string[] };
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(
      h(PanelTabStrip, {
        tabs: ['files', 'git'],
        panels: new Map([
          ['files', FILES],
          ['git', GIT],
        ]),
        active: 'files',
        onAdd: () => (calls.add += 1),
        onSelect: (id: string) => calls.select.push(id),
        onClose: (id: string) => calls.close.push(id),
        ...props,
      }),
      container,
    );
  });
  return calls;
}

describe('PanelTabStrip', () => {
  test('one chip per open tab, marked pressed only for the active one', () => {
    mount();
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false');
  });

  test('the add control opens the catalog instead of appending a blank tab', () => {
    const calls = mount();
    const add = container.querySelector('[aria-label="Tambah tab"]') as HTMLElement;
    expect(add).not.toBeNull();
    act(() => add.click());
    expect(calls.add).toBe(1);
    // Nothing was appended and nothing was selected by the add itself.
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(calls.select).toEqual([]);
  });

  test('the close control is VISIBLE on every chip, not only the active one', () => {
    mount();
    // A hover-revealed X does not exist on a touch screen and made the active
    // chip look like the only closable one. Both chips carry `opacity-100`
    // implicitly by having no `opacity-0` class at all.
    const closes = [...container.querySelectorAll('[aria-label^="Tutup tab"]')];
    expect(closes).toHaveLength(2);
    for (const close of closes) expect(close.className).not.toContain('opacity-0');
  });

  test('a background chip still exposes its close control', () => {
    mount({ active: 'files' });
    const inactive = container.querySelectorAll('[role="tab"]')[1];
    const close = inactive?.querySelector('[aria-label^="Tutup tab"]');
    expect(close).not.toBeNull();
    expect(close?.className).not.toContain('opacity-0');
  });

  test('a close control exists on every closable chip and names its target', () => {
    const calls = mount();
    const closeButtons = container.querySelectorAll('[aria-label^="Tutup tab"]');
    expect(closeButtons).toHaveLength(2);
    act(() => (closeButtons[1] as HTMLElement).click());
    expect(calls.close).toEqual(['git']);
  });

  test('the pinned view has NO close control, so the way back cannot be deleted', () => {
    mount({
      tabs: ['sessions', 'files'],
      panels: new Map([
        ['sessions', SESSIONS],
        ['files', FILES],
      ]),
      active: 'sessions',
      pinned: 'sessions',
    });
    const closeButtons = container.querySelectorAll('[aria-label^="Tutup tab"]');
    expect(closeButtons).toHaveLength(1);
    expect(closeButtons[0]?.getAttribute('aria-label')).toBe('Tutup tab Files');
  });

  test('a tab id with no catalog entry draws no chip rather than an empty one', () => {
    mount({ tabs: ['files', 'gone'], active: 'files' });
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
  });

  test('the strip is one tab stop: only the active chip is reachable with Tab', () => {
    mount();
    const tabs = [...container.querySelectorAll('[role="tab"]')] as HTMLElement[];
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1']);
  });

  test('keeps its accessibility name when a chip shows the short label', () => {
    mount();
    // The chip's own trigger is the FIRST label-bearing control inside the tab;
    // the close button is the second and names itself differently.
    const labels = [...container.querySelectorAll('[role="tab"] button[aria-label^="Files"], [role="tab"] button[aria-label^="GIT"]')]
      .filter((element) => !element.getAttribute('aria-label')?.startsWith('Tutup'))
      .map((element) => element.getAttribute('aria-label'));
    expect(labels).toEqual(['Files — title', 'GIT — title']);
  });

  test('on the home page NO chip is selected, because home is not a tab', () => {
    mount({ home: true });
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'false']);
    // Nothing is a tab stop either: the strip has no current chip to land on.
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '-1']);
  });

  test('every closable chip is a drag source, and the pinned one is not', () => {
    mount({
      tabs: ['sessions', 'files', 'git'],
      panels: new Map([
        ['sessions', SESSIONS],
        ['files', FILES],
        ['git', GIT],
      ]),
      active: 'sessions',
      pinned: 'sessions',
      onReorder: () => {},
    });
    const chips = [...container.querySelectorAll('[role="tab"]')] as HTMLElement[];
    // `undefined` is how a non-draggable chip reads: Preact omits a `false`
    // boolean attribute, so the ABSENCE is the signal.
    expect(chips.map((chip) => chip.getAttribute('draggable'))).toEqual([null, 'true', 'true']);
  });

  test('a strip with no onReorder is read-only, so a phone cannot write an order', () => {
    mount();
    const chips = [...container.querySelectorAll('[role="tab"]')] as HTMLElement[];
    expect(chips.map((chip) => chip.getAttribute('draggable'))).toEqual([null, null]);
  });

  test('a TOUCH device gets a bigger chip and close target than a mouse does', () => {
    mount();
    // Measured in Chromium at 390px: the close control was 20x20 inside a 28px
    // chip, both under the 44px touch floor. The coarse variants are the fix, and
    // a DOM test can only pin the CONTRACT — the pixel sizes are the stylesheet's
    // (verified in the built CSS, under `@media (pointer:coarse)`).
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    const chip = container.querySelector('[role="tab"]') as HTMLElement;
    const close = container.querySelector('[aria-label^="Tutup tab"]') as HTMLElement;
    expect(strip.className).toContain('pointer-coarse:h-11');
    expect(chip.className).toContain('pointer-coarse:h-9');
    expect(close.className).toContain('pointer-coarse:h-7');
    expect(close.className).toContain('pointer-coarse:w-7');
  });

  test('a column action lands outside the scroller, so a narrow strip cannot clip it', () => {
    mount({ actions: h('button', { type: 'button', 'aria-label': 'Muat ulang view' }, 'x') });
    const action = container.querySelector('[aria-label="Muat ulang view"]');
    expect(action).not.toBeNull();
    expect(action?.closest('.no-scrollbar')).toBeNull();
  });
});
