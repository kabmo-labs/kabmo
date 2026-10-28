/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The placement control a panel's own card carries.
 *
 * A plugin registers a SLOT, never a column — `app.rightPanel(...)` is a view
 * with a button, and the user decides whether that button sits on the left dock
 * or in the right column. The card therefore has to show where the panel is now
 * and offer the move, and three failures each read as a different true
 * statement:
 *
 * - a chip for a destination the slot cannot use offers a move the store
 *   refuses, so the button does nothing and looks broken;
 * - the current destination left ENABLED invites a click that changes nothing;
 * - a takeover given a chip row implies a choice it does not have (the editor
 *   column is its only home), which is a control that can never act.
 *
 * The move goes through the dock's store, which is what turns the rail on — so
 * the assertion is on the store's state, not on a component's local flag.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { PlacementChips } from '@/client/components/settings/categories/panel-plugins/Placement';
import { pluginPanelKey } from '@/shared/lib/workspace/panel-ids';
import { readLeftDock, writeLeftDock } from '@/shared/lib/workspace/left-dock';
import type { LeftDockHandle } from '@/client/hooks/workspace/left-dock';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  writeLeftDock({ enabled: false, panels: [] });
});

afterAll(() => {
  restoreDomGlobals();
});

/**
 * The dock's real store behind a handle, so a click is observed where the layout
 * reads it — a stubbed `setSide` would prove the button calls a function, not
 * that the panel moved.
 */
function dockHandle(): LeftDockHandle {
  return {
    ...readLeftDock(),
    setEnabled: (enabled) => writeLeftDock({ enabled }),
    setSide: (panelId, side) => {
      const state = readLeftDock();
      if (side === 'left') {
        writeLeftDock({
          enabled: true,
          panels: state.panels.includes(panelId) ? state.panels : [...state.panels, panelId],
        });
        return;
      }
      writeLeftDock({ panels: state.panels.filter((id) => id !== panelId) });
    },
    widthOf: () => 320,
    commitWidth: () => {},
  };
}

/** Mount one element and return the container. */
function mount(node: h.JSX.Element): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container));
  return container;
}

/** The chips' buttons, by their short label. */
function chip(el: HTMLElement, label: 'Left' | 'Right'): HTMLButtonElement | undefined {
  return [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined;
}

describe('PlacementChips', () => {
  test('a rightPanel offers both destinations, with the current one marked', () => {
    const el = mount(
      h(PlacementChips, { name: 'Stats', pluginId: 'stats', slot: 'rightPanel', dock: dockHandle() }),
    );
    const left = chip(el, 'Left');
    const right = chip(el, 'Right');
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    // Nothing is placed, so the right column is where it is.
    expect(right?.disabled).toBe(true);
    expect(right?.getAttribute('aria-pressed')).toBe('true');
    expect(left?.disabled).toBe(false);
    expect(left?.getAttribute('aria-label')).toBe('Move Stats to the left dock');
  });

  test('moving to the left writes the dock, and turns its rail on', () => {
    const dock = dockHandle();
    const el = mount(h(PlacementChips, { name: 'Stats', pluginId: 'stats', slot: 'rightPanel', dock }));
    act(() => chip(el, 'Left')?.click());

    const key = pluginPanelKey('stats', 'rightPanel');
    expect(readLeftDock().panels).toEqual([key]);
    // A placement with the rail off is a move with no button and no way back —
    // the store couples them, and this is what proves the card goes through it.
    expect(readLeftDock().enabled).toBe(true);
  });

  test('the current destination is disabled, so a chip cannot re-place what is placed', () => {
    const key = pluginPanelKey('stats', 'rightPanel');
    writeLeftDock({ enabled: true, panels: [key] });
    const el = mount(
      h(PlacementChips, { name: 'Stats', pluginId: 'stats', slot: 'rightPanel', dock: dockHandle() }),
    );
    expect(chip(el, 'Left')?.disabled).toBe(true);
    expect(chip(el, 'Left')?.getAttribute('aria-pressed')).toBe('true');
    expect(chip(el, 'Right')?.disabled).toBe(false);
  });

  test('a takeover gets no chips — the editor column is its only home', () => {
    const el = mount(
      h(PlacementChips, { name: 'Scratchpad', pluginId: 'session-info', slot: 'panel', dock: dockHandle() }),
    );
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });

  test('a second plugin panel is placed independently of the first', () => {
    const dock = dockHandle();
    const first = mount(
      h(PlacementChips, { name: 'A', pluginId: 'a', slot: 'rightPanel', dock }),
    );
    act(() => chip(first, 'Left')?.click());
    const second = mount(
      h(PlacementChips, { name: 'B', pluginId: 'b', slot: 'rightPanel', dock }),
    );
    // B is still on the right: one plugin's placement must not drag another's.
    expect(chip(second, 'Right')?.disabled).toBe(true);
    expect(readLeftDock().panels).toEqual([pluginPanelKey('a', 'rightPanel')]);
  });
});
