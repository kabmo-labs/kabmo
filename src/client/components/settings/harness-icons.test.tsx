/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The settings menu's harness icons are the VENDORS' marks, not lucide shapes.
 *
 * The rest of the app already identifies an agent by its own logo — a session
 * row, the composer's tab strip, a model row — so a generic `Waypoints` glyph
 * beside the word "claude" asked the reader to learn a second vocabulary for the
 * same fact. The overview keeps its lucide glyph because it is not an agent, and
 * a brand mark there would claim it were one.
 *
 * The alignment assertion is the subtle half: the marks have DIFFERENT viewBoxes
 * (omp is 64x64, the rest 24x24), so an unstyled inline svg makes every label
 * beside it shift. Measured before the fixed slot: the whole HARNESSES group's
 * labels sat ~2px off the rest of the menu.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SETTINGS_CATEGORIES, SettingsSidebar } from '@/client/components/settings/Sidebar';
import { harnessMenuEntries } from '@/shared/lib/harness/menu';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(active: string): HTMLElement {
  act(() =>
    render(
      h(SettingsSidebar, {
        activeCategory: active as never,
        onSelectCategory: () => {},
        searchQuery: '',
        onSearchChange: () => {},
        onReloadOmp: () => {},
        isReloading: false,
        onRestartKabmo: () => {},
        isRestarting: false,
      }),
      container,
    ),
  );
  return container;
}

function rowFor(root: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find(
    (button) => (button.querySelector('span.truncate')?.textContent ?? '') === label,
  );
  if (!found) throw new Error(`no row named ${label}`);
  return found as HTMLButtonElement;
}

describe('settings menu harness icons', () => {
  test('every harness page draws its vendor mark', () => {
    const root = mount('harness-index');
    for (const entry of harnessMenuEntries()) {
      if (!entry.harness) continue;
      const mark = rowFor(root, entry.label).querySelector('span[data-harness] svg');
      expect(mark, `${entry.label} has no brand mark`).not.toBeNull();
    }
  });

  test('the overview is NOT an agent, so it keeps the lucide glyph', () => {
    const root = mount('harness-index');
    const row = rowFor(root, 'All Harnesses');
    expect(row.querySelector('span[data-harness]')).toBeNull();
    expect(row.querySelector('svg.lucide')).not.toBeNull();
  });

  test('the mark is a branded svg, not a substituted lucide shape', () => {
    const root = mount('harness-index');
    const claude = rowFor(root, 'claude');
    expect(claude.querySelector('span[data-harness] svg')?.getAttribute('data-harness')).toBe('claudecode');
    // The generic glyph must be GONE from this row, not merely accompanied.
    expect(claude.querySelector('svg.lucide')).toBeNull();
  });

  test('the mark carries the VENDOR key, not the harness id', () => {
    // `opencode`'s harness id and its brand key coincide; `ll`-style pairs do not,
    // so the assertion is on the key the art is filed under.
    const root = mount('harness-index');
    const one = rowFor(root, 'opencode').querySelector('span[data-harness] svg');
    expect(one?.getAttribute('data-harness')).toBe('opencode');
    // The retired `opencode2` row is gone: one binary, one menu entry.
    expect(Array.from(root.querySelectorAll('span.truncate')).some((s) => s.textContent === 'opencode2')).toBe(false);
  });

  test('a non-harness row is untouched', () => {
    const root = mount('appearance');
    for (const label of ['Appearance', 'Providers', 'Projects']) {
      const row = rowFor(root, label);
      expect(row.querySelector('span[data-harness]')).toBeNull();
      expect(row.querySelector('svg.lucide')).not.toBeNull();
    }
  });

  test('the mark sits in a fixed-width slot so labels stay aligned', () => {
    // The marks' viewBoxes differ, so the slot — not the svg — is what holds the
    // column. A row that skipped it would shift its own label only.
    const root = mount('harness-index');
    for (const entry of harnessMenuEntries()) {
      if (!entry.harness) continue;
      const slot = rowFor(root, entry.label).querySelector('span[data-harness]')?.parentElement;
      expect(slot?.className).toContain('w-[14px]');
    }
    // And every harness page in the catalog declares the id the slot wraps.
    const declared = SETTINGS_CATEGORIES.filter((category) => category.section === 'HARNESSES' && category.harness);
    expect(declared).toHaveLength(harnessMenuEntries().filter((entry) => entry.harness).length);
  });
});
