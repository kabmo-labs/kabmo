/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Panel placement section: built-in views are placeable rows.
 *
 * The section used to list contributed panels only, which is exactly the bug
 * this file guards: a built-in view could not be placed even though the store
 * and the catalog accepted it. Three properties are asserted here:
 *
 * - a built-in view gets a row with both destinations, and the destination it
 *   is on is disabled;
 * - a click writes the dock's own store (so placing it turns the rail on), not
 *   a local flag;
 * - a switched-off view gets NO row, because a placement for a panel that
 *   cannot be drawn is a control that opens nothing.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { LeftDockSettings } from '@/client/components/settings/categories/panel-plugins/LeftDockSettings';
import { readLeftDock, setPanelSide, writeLeftDock } from '@/shared/lib/workspace/left-dock';
import { resolveLeftDockWidth, saveLeftDockWidth } from '@/shared/lib/workspace/left-dock-width';
import type { LeftDockHandle } from '@/client/hooks/workspace/left-dock';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement | null = null;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container = null;
  writeLeftDock({ enabled: false, panels: [] });
});

afterAll(() => {
  restoreDomGlobals();
});

/** The dock's real store behind a handle, so a click is observed at its source. */
function dockHandle(): LeftDockHandle {
  return {
    ...readLeftDock(),
    setEnabled: (enabled) => writeLeftDock({ enabled }),
    setSide: (panelId, side) => setPanelSide(panelId, side),
    setOrder: (panelIds) => writeLeftDock({ panels: [...panelIds] }),
    widthOf: resolveLeftDockWidth,
    commitWidth: saveLeftDockWidth,
  };
}

function mount(disabledPanels: string[] = []): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() =>
    render(
      h(LeftDockSettings, { dock: dockHandle(), plugins: [], slots: new Map(), disabledPanels }),
      container!,
    ),
  );
  return container;
}

/** The move control for one destination, by its accessible name. */
function moveButton(el: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label) as
    | HTMLButtonElement
    | undefined;
}

describe('LeftDockSettings placement rows', () => {
  test('a built-in view offers both rails, with the current one disabled', () => {
    const el = mount();
    const left = moveButton(el, 'Move Source Control to the left dock');
    const right = moveButton(el, 'Source Control is on the right column');
    expect(left).toBeDefined();
    expect(left?.disabled).toBe(false);
    expect(right?.disabled).toBe(true);
  });

  test('moving a built-in to the left writes the dock and turns its rail on', () => {
    const el = mount();
    act(() => moveButton(el, 'Move Source Control to the left dock')?.click());
    expect(readLeftDock()).toEqual({ enabled: true, panels: ['git'] });
  });

  test('a view already on the dock offers the move back', () => {
    writeLeftDock({ enabled: true, panels: ['git'] });
    const el = mount();
    expect(moveButton(el, 'Source Control is on the left dock')?.disabled).toBe(true);
    act(() => moveButton(el, 'Move Source Control to the right column')?.click());
    expect(readLeftDock()).toEqual({ enabled: true, panels: [] });
  });

  test('a switched-off built-in gets no placement row', () => {
    const el = mount(['git']);
    expect(moveButton(el, 'Move Source Control to the left dock')).toBeUndefined();
    expect(el.textContent).not.toContain('Source Control');
  });
});
