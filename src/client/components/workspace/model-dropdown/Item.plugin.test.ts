/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer's model picker is the other surface a plugin's `providerIcon`
 * registration must reach.
 *
 * A picker row is the harder call site of the two: its provider arrives as a
 * display name (`DeepSeek`) plus a legacy catalog key (`deepseek`), and its
 * neighbour draws a Lucide icon, so the mark has to be found through the same
 * folded keys the built-in table uses.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ModelDropdownItem } from '@/client/components/workspace/model-dropdown/Item';
import { PROVIDER_GLYPHS } from '@/client/components/common/provider-icon/glyphs';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import type { AIModelOption } from '@/shared/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const CUSTOM = '<svg viewBox="0 0 32 32"><path d="M4 4h24v24H4z"/></svg>';

let container: HTMLElement;

beforeEach(() => {
  resetListSlots();
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  resetListSlots();
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

function mount(model: AIModelOption): void {
  act(() => {
    render(
      h(ModelDropdownItem, {
        model,
        isSelected: false,
        isFocused: false,
        onSelect: () => {},
        onToggleFavorite: () => {},
        onMouseEnter: () => {},
      }),
      container,
    );
  });
}

function mark(): Element | null {
  return container.querySelector('svg[fill="currentColor"]');
}

describe('model picker and the providerIcon slot', () => {
  test('a registered mark renders in a picker row', () => {
    registerListSlot('demo', 'providerIcon', { id: 'ds', provider: 'deepseek', glyph: CUSTOM });

    mount({ id: 'v3', name: 'DeepSeek V3', provider: 'DeepSeek', providerIcon: 'deepseek' });

    expect(mark()?.getAttribute('viewBox')).toBe('0 0 32 32');
  });

  test('the registration is found by the display name alone, not only the legacy key', () => {
    registerListSlot('demo', 'providerIcon', { id: 'acme', provider: 'acme-cloud', glyph: CUSTOM });

    // No `providerIcon` on the row: only `provider` ("Acme Cloud") can match,
    // and it must fold onto the registration's `acme-cloud`.
    mount({ id: 'm1', name: 'Acme One', provider: 'Acme Cloud' });

    expect(mark()?.getAttribute('viewBox')).toBe('0 0 32 32');
  });

  test('with no plugins a picker row keeps its built-in mark', () => {
    mount({ id: 'v3', name: 'DeepSeek V3', provider: 'DeepSeek', providerIcon: 'deepseek' });

    expect(mark()?.getAttribute('viewBox')).toBe(PROVIDER_GLYPHS.deepseek.viewBox);
  });
});
