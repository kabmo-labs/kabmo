/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The "add provider" preset rows draw their mark on the shared plate.
 *
 * The preset grid is a provider surface like the settings list and the composer
 * picker, and it used the bare `ProviderIcon`: a brand SVG came out square while
 * an unknown provider's initials came out as a text-width pill, so two cards in
 * one grid started their names at different x. The plate is the fixed box that
 * gives every card a shared origin — and a preset has no fetched web icon (it is
 * offered for a provider that is not configured yet), so it must draw the
 * built-in mark rather than an empty box.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { PresetPicker } from '@/client/components/settings/categories/provider-settings/PresetPicker';
import type { PresetProviderOption } from '@/shared/types/settings/provider';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

const presets: PresetProviderOption[] = [
  { id: 'openai', slug: 'openai', name: 'OpenAI', icon: 'openai', group: 'Hosted', defaultUrl: '' },
  { id: 'my-gw', slug: 'my-gw', name: 'My Gateway', icon: '', group: 'Hosted', defaultUrl: '' },
] as PresetProviderOption[];

beforeEach(() => {
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
  restoreDomGlobals();
});

describe('preset picker marks', () => {
  test('every preset card carries an 18px plate with the built-in mark', () => {
    act(() => {
      render(
        h(PresetPicker, { presets, selectedPresetId: '', onSelectPreset: () => {} }),
        container,
      );
    });

    const plates = [...container.querySelectorAll('span[aria-hidden]')].filter(
      (span) => (span as HTMLElement).style.width === '18px',
    ) as HTMLElement[];
    expect(plates).toHaveLength(2);
    // The known brand draws its glyph; the unknown one draws initials — never an
    // empty plate, which would read as a missing icon.
    expect(plates[0]?.querySelector('svg')).not.toBeNull();
    expect(plates[1]?.textContent).toBe('mg.');
  });

  test('a preset row has no web icon: it is offered for an unconfigured provider', () => {
    act(() => {
      render(
        h(PresetPicker, { presets, selectedPresetId: 'openai', onSelectPreset: () => {} }),
        container,
      );
    });
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});
