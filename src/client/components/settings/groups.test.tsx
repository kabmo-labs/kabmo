/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The settings sidebar's groups.
 *
 * The failure this prevents is silent: the group list used to be written twice
 * — once as the `section` union, once as the `sections` array beside the render
 * loop — so a group added to the union but forgotten in the array rendered
 * NOTHING under it. No error, no empty state: the loop simply never asked for
 * that group, and every category filed under it disappeared from the settings
 * drawer.
 *
 * So the assertions are structural, not cosmetic:
 *
 *  - every category's group is one of the groups the sidebar draws;
 *  - every group is drawn exactly once, in `SETTINGS_SECTIONS` order;
 *  - a category is reachable from the drawer — the count that renders equals the
 *    count declared;
 *  - `harnesses` is its OWN group. omp's group holds one engine's config; that
 *    group holds other agents entirely, with a different transport and a
 *    different config file.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SETTINGS_CATEGORIES, SettingsSidebar } from '@/client/components/settings/Sidebar';
import { SETTINGS_SECTIONS } from '@/shared/lib/settings/sections';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
});

afterAll(() => {
  restoreDomGlobals();
});

describe('settings groups', () => {
  test('every category files under a group the sidebar draws', () => {
    for (const category of SETTINGS_CATEGORIES) {
      expect(SETTINGS_SECTIONS).toContain(category.section);
    }
  });

  test('Harnesses is its own group, not a member of OMP', () => {
    const harnesses = SETTINGS_CATEGORIES.find((category) => category.id === 'harness-index');
    expect(harnesses?.section).toBe('HARNESSES');
    // And the group sits after OMP, before LIBRARY: the order the sidebar reads.
    expect(SETTINGS_SECTIONS.indexOf('HARNESSES')).toBeGreaterThan(SETTINGS_SECTIONS.indexOf('OMP'));
    expect(SETTINGS_SECTIONS.indexOf('HARNESSES')).toBeLessThan(SETTINGS_SECTIONS.indexOf('LIBRARY'));
  });

  test('the drawer renders one heading per non-empty group, in order', () => {
    container = document.createElement('div');
    document.body.append(container);
    act(() =>
      render(
        h(SettingsSidebar, {
          activeCategory: 'appearance',
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

    // The headings carry the group name verbatim; nothing else in the drawer is
    // uppercase monospace, which is why they can be selected this way.
    const headings = Array.from(container.querySelectorAll('.font-mono.uppercase'))
      .map((el) => el.textContent?.trim() ?? '');
    const expected = SETTINGS_SECTIONS.filter((section) =>
      SETTINGS_CATEGORIES.some((category) => category.section === section),
    );
    expect(headings).toEqual([...expected]);
  });

  test('every declared category is reachable from the drawer', () => {
    // The count, not a spot check: the silent failure was an entire GROUP
    // missing, and a spot check on one category would have passed.
    container = document.createElement('div');
    document.body.append(container);
    act(() =>
      render(
        h(SettingsSidebar, {
          activeCategory: 'appearance',
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

    const labels = Array.from(container.querySelectorAll('button'))
      .map((button) => button.textContent?.trim() ?? '');
    for (const category of SETTINGS_CATEGORIES) {
      expect(labels).toContain(category.label);
    }
  });
});
