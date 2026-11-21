/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The settings sheet draws ONE header band, and it names whatever screen is up.
 *
 * The phone used to draw three: the sheet's bar (64px), the master/detail back
 * bar (35px) and the drilled group's band (64px) — measured at 390x844 on
 * Settings → Appearance → Palette, 163px of an 844px screen on three rows that
 * each meant "go back", two of which did it. These cases pin the structure that
 * replaced it: one band, one back control, and the band's label following the
 * category's registration.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { SettingsBand } from '@/client/components/settings/Band';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

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

function mount(node: preact.ComponentChild): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container));
  return container;
}

describe('the settings band', () => {
  test('the sheet root has a close control and NO back control', () => {
    const root = mount(h(SettingsBand, { root: true, label: 'Settings', onClose: () => {} }));
    expect(root.textContent).toContain('Settings');
    expect(root.querySelector('button[aria-label="Close settings"]')).not.toBeNull();
    // A back control on the root would be a control that does nothing.
    expect(root.querySelector('button[aria-label^="Back"]')).toBeNull();
  });

  test('a drilled screen gets the one back control, named by its owner', () => {
    const root = mount(
      h(SettingsBand, {
        label: 'Palette',
        description: 'The palette every surface is painted from.',
        onBack: () => {},
        backLabel: 'Back to Appearance settings',
        onClose: () => {},
      }),
    );
    const back = root.querySelector('button[aria-label="Back to Appearance settings"]');
    expect(back).not.toBeNull();
    // Hidden on a desktop, where both panes are visible and nothing is left.
    expect(back?.className).toContain('md:hidden');
    expect(root.textContent).toContain('Palette');
  });

  test('the band is the shared band height plus the notch', () => {
    const root = mount(h(SettingsBand, { root: true, label: 'Settings', onClose: () => {} }));
    const band = root.firstElementChild as HTMLElement;
    expect(band.className).toContain('border-b');
    // `SETTINGS_BAND_HEIGHT_INSET`: the sheet's band is the surface's top edge,
    // so it carries the notch. happy-dom drops an `env()` in a shorthand, which
    // is why the height (and not `paddingTop`) is the assertion — the same note
    // `drawer-strip.tsx` records for the tab strip.
    expect(band.style.height).toContain('4rem');
    expect(band.style.height).toContain('env(safe-area-inset-top, 0px)');
  });
});
