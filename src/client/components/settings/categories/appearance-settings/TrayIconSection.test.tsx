/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Tray icon" — the two cards, and the artwork each one promises.
 *
 * The previews are the point: the setting swaps the shipped app icon for the K
 * mark alone, so a card that showed the same picture twice would be a control
 * with no visible consequence. The colour card reads the shipped `icon.svg`
 * (the file the tray loads); the monochrome card draws the glyph in the palette
 * ink.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { TrayIconSection } from '@/client/components/settings/categories/appearance-settings/TrayIconSection';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { SettingsState } from '@/shared/types';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(
  trayIconStyle: SettingsState['trayIconStyle'],
  onUpdate: (updater: Partial<SettingsState> | ((previous: SettingsState) => SettingsState)) => void = () => {},
): HTMLElement {
  container = document.body.appendChild(document.createElement('div'));
  act(() =>
    render(
      h(TrayIconSection, {
        settings: { trayIconStyle } as SettingsState,
        onUpdate,
      }),
      container,
    ),
  );
  return container;
}

describe('tray icon section', () => {
  test('the stored style is the pressed card', () => {
    const el = mount('monochrome');
    const pressed = el.querySelector('[aria-pressed="true"]');
    expect(pressed?.textContent).toContain('Monochrome');
  });

  test('the colour card shows the shipped app icon, the monochrome card the glyph', () => {
    const el = mount('color');
    expect(el.querySelector('img[src="/icon.svg"]')).not.toBeNull();
    expect(el.querySelector('svg path')).not.toBeNull();
  });

  test('picking the other card reports the new style', () => {
    const updates: Partial<SettingsState>[] = [];
    const el = mount('color', (updater) => {
      if (typeof updater !== 'function') updates.push(updater);
    });
    const monochrome = [...el.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Monochrome'),
    );
    act(() => monochrome?.click());
    expect(updates).toEqual([{ trayIconStyle: 'monochrome' }]);
  });
});
