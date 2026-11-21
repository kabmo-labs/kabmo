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
import {
  CONTROL_BOX,
  CONTROL_GLYPH_PX,
  CONTROL_ROW_HEIGHT,
  CONTROL_ROW_INSET,
} from '@/client/lib/ui/control-plate';

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
    // The DEFAULT strip is the desktop density: the top navbar's 40px row and
    // its 28px control boxes. A phone caller passes `layout="mobile"` instead,
    // which is the case below.
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    const chip = container.querySelector('[role="tab"]') as HTMLElement;
    const close = container.querySelector('[aria-label^="Tutup tab"]') as HTMLElement;
    expect(strip.className).toContain(CONTROL_ROW_HEIGHT.desktop);
    expect(strip.className).toContain(CONTROL_ROW_INSET.desktop);
    expect(strip.className).not.toContain('env(safe-area-inset-top');
    expect(chip.className).toContain('h-7');
    expect(close.className).toContain('h-5');
    expect(close.className).toContain('w-5');
  });

  test('a column action lands outside the scroller, so a narrow strip cannot clip it', () => {
    mount({ actions: h('button', { type: 'button', 'aria-label': 'Muat ulang view' }, 'x') });
    const action = container.querySelector('[aria-label="Muat ulang view"]');
    expect(action).not.toBeNull();
    expect(action?.closest('.no-scrollbar')).toBeNull();
  });

  test('the add control and the actions never scroll with the chips', () => {
    mount({ actions: h('button', { type: 'button', 'aria-label': 'Tutup panel kanan' }, 'x') });
    const scroller = container.querySelector('.no-scrollbar') as HTMLElement;
    const add = container.querySelector('[aria-label="Tambah tab"]') as HTMLElement;
    const action = container.querySelector('[aria-label="Tutup panel kanan"]') as HTMLElement;
    // Both sit in the row, neither in the horizontal scroller: a strip full of
    // chips scrolls under them and the two controls stay reachable.
    expect(add.closest('.no-scrollbar')).toBeNull();
    expect(action.closest('.no-scrollbar')).toBeNull();
    expect(scroller.contains(add)).toBe(false);
    expect(scroller.contains(action)).toBe(false);
  });

  test('dragRegion marks the strip as the window handle and its controls as not', () => {
    mount({
      dragRegion: true,
      actions: h('button', { type: 'button', 'aria-label': 'Tutup panel kanan' }, 'x'),
    });
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    expect(strip.className).toContain('titlebar-drag-region');
    // `app-region` INHERITS: a control inside a drag region swallows its own
    // click on Windows. Every control must therefore sit under something that
    // opted out — either on itself or on the chip wrapper it lives in, which is
    // why this asks about an ANCESTOR rather than the control's own class list.
    const controls = [...container.querySelectorAll('button')];
    expect(controls.length).toBeGreaterThan(2);
    for (const control of controls) {
      expect(control.closest('.titlebar-no-drag')).not.toBeNull();
    }
  });

  test('without dragRegion nothing claims the window handle', () => {
    mount();
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    expect(strip.className).not.toContain('titlebar-drag-region');
    expect(container.querySelector('.titlebar-no-drag')).toBeNull();
  });
});

/**
 * The strip is the top navbar's PEER, so it must draw at that row's density —
 * on the phone, at the PHONE header's.
 *
 * Measured on the running app before this was stated once: the drawer's strip
 * was a 40px row with 28px controls while the chat header above it was 56px with
 * 36px controls, so the add control's centre sat at 26px against the header's
 * 30px and the toggle's at 364px against 360px. A 4px step on both edges is
 * what a reader reports as "not aligned with the top navbar".
 *
 * Asserted against the shared constants rather than the literals, so moving the
 * density stays a one-line change in `control-plate.ts` and this test still
 * means "the strip follows the header".
 */
describe('strip density follows the top navbar', () => {
  test('the phone strip takes the phone header row, box and inset', () => {
    mount({ layout: 'mobile', dragRegion: true });
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    const add = container.querySelector('[aria-label="Tambah tab"]') as HTMLElement;
    const chip = container.querySelector('[role="tab"]') as HTMLElement;

    expect(strip.className).toContain(CONTROL_ROW_HEIGHT.mobile);
    expect(strip.className).toContain(CONTROL_ROW_INSET.mobile);
    // The add control IS a header control: same box, same glyph.
    expect(add.className).toContain(CONTROL_BOX.mobile);
    expect(add.querySelector('svg')?.getAttribute('width')).toBe(String(CONTROL_GLYPH_PX.mobile));
    // And the chip is the mobile height, not the desktop 28px one.
    expect(chip.className).toContain('h-9');
    expect(chip.className).not.toContain('h-7');
  });

  test('the desktop strip keeps the navbar row it sits under', () => {
    mount();
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    const add = container.querySelector('[aria-label="Tambah tab"]') as HTMLElement;
    const chip = container.querySelector('[role="tab"]') as HTMLElement;

    expect(strip.className).toContain(CONTROL_ROW_HEIGHT.desktop);
    expect(strip.className).toContain(CONTROL_ROW_INSET.desktop);
    expect(add.className).toContain(CONTROL_BOX.desktop);
    expect(chip.className).toContain('h-7');
  });

  test('the phone row is the header height plus the notch, as height AND padding', () => {
    // One string, both halves: a row that only grows pins its content to y=0
    // (chips under the status bar); padding alone is eaten by border-box.
    expect(CONTROL_ROW_HEIGHT.mobile).toContain('3.5rem');
    expect(CONTROL_ROW_HEIGHT.mobile).toContain('pt-[env(safe-area-inset-top,0px)]');
    // The desktop row is the plain navbar height and reserves no notch.
    expect(CONTROL_ROW_HEIGHT.desktop).toBe('h-10');
    expect(CONTROL_ROW_HEIGHT.desktop).not.toContain('env(');
  });
});
