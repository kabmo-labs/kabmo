/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The settings sidebar's two bottom actions.
 *
 * "Reload OMP" and "Restart" are different operations on different things — a
 * standby-process recycle versus replacing the serving process — so the tests
 * pin that each button reaches its OWN callback and that both carry an
 * accessible name (the labels are what a screen reader and a spec address
 * them by, and the two sit side by side at 11px).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SettingsSidebar } from '@/client/components/settings/Sidebar';
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

interface Clicked {
  reload: number;
  restart: number;
}

function mount(clicked: Clicked): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() =>
    render(
      h(SettingsSidebar, {
        activeCategory: 'appearance',
        onSelectCategory: () => {},
        searchQuery: '',
        onSearchChange: () => {},
        onReloadOmp: () => {
          clicked.reload += 1;
        },
        isReloading: false,
        onRestartKabmo: () => {
          clicked.restart += 1;
        },
        isRestarting: false,
      }),
      container,
    ),
  );
  return container;
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find((el) => el.getAttribute('aria-label') === label);
  if (!found) throw new Error(`no button named ${label}`);
  return found as HTMLButtonElement;
}

describe('SettingsSidebar bottom actions', () => {
  test('the reload control is named "Reload OMP", not "Reload OMP Engine"', () => {
    const root = mount({ reload: 0, restart: 0 });
    expect(button(root, 'Reload OMP').textContent).toContain('Reload OMP');
    // The restart button sits beside it at 11px; a truncated label would read
    // "Restart" and lose which thing is being restarted.
    expect(button(root, 'Restart Kabmo').textContent).toContain('Restart Kabmo');
  });

  test('each button reaches its own action', () => {
    const clicked = { reload: 0, restart: 0 };
    const root = mount(clicked);

    act(() => button(root, 'Reload OMP').click());
    expect(clicked).toEqual({ reload: 1, restart: 0 });

    act(() => button(root, 'Restart Kabmo').click());
    expect(clicked).toEqual({ reload: 1, restart: 1 });
  });

  test('both are disabled while either operation runs', () => {
    // Two buttons that both replace something must not be pressed at once: a
    // reload while the server is restarting answers a socket nobody serves.
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
          isReloading: true,
          onRestartKabmo: () => {},
          isRestarting: false,
        }),
        container,
      ),
    );

    expect(button(container, 'Reload OMP').disabled).toBe(true);
    expect(button(container, 'Restart Kabmo').disabled).toBe(true);
  });
});
