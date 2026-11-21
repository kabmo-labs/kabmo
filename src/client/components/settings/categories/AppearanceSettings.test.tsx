/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance is two panes, and a phone is two screens.
 *
 * Three facts are pinned here, each one a way the category can look right on a
 * desktop and be unusable on a phone:
 *
 * - the sidebar lists every group and opens on the palette, so the category
 *   never lands on an empty detail;
 * - choosing a group swaps the detail pane and writes NO setting — a row is
 *   navigation, not an edit;
 * - on a phone the list yields to the chosen group, and the back bar returns to
 *   it. The panes are hidden by class (`hidden md:flex`), so the classes are
 *   what is asserted; if `AppearanceSettings` ever selects a group without
 *   calling `openDetail`, the phone stays on the list and this fails.
 *
 * The section count is the second half of the same contract: the detail pane
 * renders exactly `group.sections`, so a group that names a section with no
 * renderer would draw nothing at all. `SECTIONS` is a `Record` keyed by the
 * union, so that one is a build error — what a test can still catch is a group
 * whose sections were emptied.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { AppearanceSettings } from '@/client/components/settings/categories/AppearanceSettings';
import { APPEARANCE_GROUPS } from '@/client/components/settings/categories/appearance-settings/groups';
import { DEFAULT_SETTINGS } from '@/shared/lib/settings/defaults';
import {
  SettingsDrillProvider,
  type SettingsDrill,
} from '@/client/components/settings/drill';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
let updates = 0;
/** What the category published to the sheet's ONE band. */
let drill: SettingsDrill | null = null;

function mount(): void {
  act(() => {
    render(
      h(
        SettingsDrillProvider,
        {
          register: (next: SettingsDrill | null) => {
            drill = next;
          },
          children: h(AppearanceSettings, {
            settings: DEFAULT_SETTINGS,
            onUpdate: () => {
              updates += 1;
            },
          }),
        },
      ),
      container,
    );
  });
}

/** The sidebar row whose label is exactly `label`. */
function groupRow(label: string): HTMLButtonElement {
  const row = [...container.querySelectorAll('button')].find(
    (button) => button.querySelector('span.font-semibold')?.textContent === label,
  );
  if (!row) throw new Error(`no group row labelled ${label}`);
  return row as HTMLButtonElement;
}

/** The section headings the detail pane currently draws, in order. */
function headings(): string[] {
  return [...container.querySelectorAll('h4')].map((heading) => heading.textContent ?? '');
}

/** The master/detail shell's two pane wrappers. */
function panes(): { list: HTMLElement; detail: HTMLElement } {
  const root = container.firstElementChild as HTMLElement;
  return { list: root.children[0] as HTMLElement, detail: root.children[1] as HTMLElement };
}

beforeEach(() => {
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
  updates = 0;
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

describe('AppearanceSettings master/detail', () => {
  test('lists every group and opens on the palette', () => {
    mount();

    for (const group of APPEARANCE_GROUPS) {
      expect(groupRow(group.label)).toBeTruthy();
    }

    expect(groupRow('Palette').getAttribute('aria-current')).toBe('true');
    expect(headings()).toEqual(['Console palette']);
  });

  test('choosing a group swaps the detail and writes no setting', () => {
    mount();

    act(() => groupRow('Shell').click());

    expect(headings()).toEqual([
      'Session sidebar',
      'Panel navigation',
      'Surfaces',
      'Rules',
      'Icons',
      'Tray icon',
    ]);
    expect(groupRow('Shell').getAttribute('aria-current')).toBe('true');
    expect(updates).toBe(0);
  });

  test('each group renders exactly the sections it names', () => {
    mount();

    for (const group of APPEARANCE_GROUPS) {
      act(() => groupRow(group.label).click());
      expect(headings()).toHaveLength(group.sections.length);
    }
  });

  /**
   * On a phone the chosen group replaces the list, and the SHEET's one band
   * names it. The pane draws no bar of its own: three stacked bars (the sheet's,
   * the master/detail back bar, the group band) were measured at 163px of an
   * 844px screen, two of them a back control. The registration IS the contract —
   * the band draws the label and calls `back`.
   */
  test('on a phone the chosen group replaces the list and registers with the sheet band', () => {
    mount();
    const { list, detail } = panes();

    expect(list.className).not.toContain('hidden');
    expect(detail.className).toContain('hidden');
    // The list is the screen, so the band keeps naming the category.
    expect(drill).toBeNull();

    act(() => groupRow('Editor').click());

    expect(list.className).toContain('hidden');
    expect(detail.className).not.toContain('hidden');
    expect(drill?.label).toBe('Editor');
    expect(drill?.backLabel).toBe('Back to Appearance settings');
    // And the pane draws no second bar of its own.
    expect(container.querySelector('button[aria-label="Back to Appearance settings"]')).toBeNull();

    act(() => drill?.back());

    expect(list.className).not.toContain('hidden');
    expect(detail.className).toContain('hidden');
    expect(drill).toBeNull();
  });
});
