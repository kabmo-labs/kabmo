/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One band height across the settings sheet.
 *
 * Every pane draws its identity row itself, so nothing but a shared constant
 * keeps the rule under them continuous: the drawer's search field, a list's
 * count and the detail's title sit side by side and their seams have to meet.
 * Measured before this, the search row was 55px against a 64px detail header
 * and the master/detail lists answered 37–44px.
 *
 * These assertions are structural on purpose — happy-dom does no layout, so the
 * height the band declares IS the fact being pinned. A band that goes back to
 * writing its own `p-3` loses the inline height and fails here.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SettingsSidebar } from '@/client/components/settings/Sidebar';
import { SettingsSidebarList } from '@/client/components/settings/SettingsSidebarList';
import { ProjectSelectorDropdown } from '@/client/components/settings/ProjectSelectorDropdown';
import { GroupSidebar } from '@/client/components/settings/master-detail/GroupSidebar';
import { GroupDetail } from '@/client/components/settings/master-detail/GroupDetail';
import { SETTINGS_BAND_HEIGHT } from '@/client/components/settings/pane-header';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(node: preact.ComponentChild): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container));
  return container;
}

/** The band a pane draws at its top, as its own first child. */
function topBand(root: HTMLElement): HTMLElement {
  const band = root.querySelector('.border-b');
  if (!band) throw new Error('the pane draws no top band');
  return band as HTMLElement;
}

describe('settings pane bands', () => {
  test('the drawer search field is the shared band height', () => {
    const root = mount(
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
    );
    expect(topBand(root).style.height).toBe(SETTINGS_BAND_HEIGHT);
  });

  test('a list pane and the project picker above it are the same height', () => {
    const listRoot = mount(
      h(SettingsSidebarList, {
        items: [],
        selectedId: null,
        onSelect: () => {},
        onAddNew: () => {},
        addTitle: 'Add',
        builtInLabel: 'Built-in',
        customLabel: 'Yours',
        formatName: (name: string) => name,
        nameClassName: 'text-xs',
        renderIcon: () => null,
        selectedProject: 'global',
        onChangeProject: () => {},
      }),
    );
    // The picker is the list's first band; the count row is the second.
    const bands = Array.from(listRoot.querySelectorAll('.border-b')).slice(0, 2);
    expect(bands).toHaveLength(2);
    for (const band of bands) {
      expect((band as HTMLElement).style.height).toBe(SETTINGS_BAND_HEIGHT);
    }
  });

  test('the picker with no projects is the band height too', () => {
    const root = mount(
      h(ProjectSelectorDropdown, { selectedProject: 'global', onChangeProject: () => {}, options: [] }),
    );
    expect(topBand(root).style.height).toBe(SETTINGS_BAND_HEIGHT);
  });

  test('a grouped category matches the drawer band on both panes', () => {
    const groups = [
      { id: 'palette' as const, label: 'Palette', hint: 'The console’s colours', icon: (() => null) as never },
    ];
    const sidebar = mount(
      h(GroupSidebar, { groups, activeGroupId: 'palette' as const, onSelectGroup: () => {} }),
    );
    expect(topBand(sidebar).style.height).toBe(SETTINGS_BAND_HEIGHT);

    const detail = mount(h(GroupDetail, { group: { label: 'Palette', description: 'Colours' }, children: null }));
    expect(topBand(detail).style.height).toBe(SETTINGS_BAND_HEIGHT);
  });
});
