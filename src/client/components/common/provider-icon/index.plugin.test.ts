/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `providerIcon` slot, at the one component every provider surface draws
 * through.
 *
 * The negative property is the one that matters: with no registration the mark
 * is byte-identical to the built-in one, so a chamber with no plugins renders
 * exactly as it did before this slot existed. The positive one is the resolution
 * ORDER — a registration wins for its provider, and only that provider.
 *
 * Rendered with `h()` (no JSX) against happy-dom, following `PluginMessageActions`.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import type { ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { ProviderIcon } from '@/client/components/common/provider-icon';
import { PROVIDER_GLYPHS } from '@/client/components/common/provider-icon/glyphs';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const CUSTOM = '<svg viewBox="0 0 32 32"><path d="M4 4h24v24H4z"/></svg>';
const OTHER = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

let container: HTMLElement;

beforeEach(() => {
  resetListSlots();
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  // UNMOUNT, not detach: the component subscribes to a module-level store, and a
  // live tree would re-render after `afterAll` removed `window`.
  render(null, container);
  container.remove();
  resetListSlots();
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

function paint(node: ComponentChild): HTMLElement {
  act(() => {
    render(node, container);
  });
  return container;
}

/** The provider mark's own `<svg>`: it is the only svg the component fills with
 *  `currentColor` (`Lucide` icons paint with `fill="none"`), so this never
 *  matches a neighbouring icon. */
function mark(): Element | null {
  return container.querySelector('svg[fill="currentColor"]');
}

describe('ProviderIcon and the providerIcon slot', () => {
  test('a registered glyph renders for its provider', () => {
    registerListSlot('demo', 'providerIcon', { id: 'acme', provider: 'acme', glyph: CUSTOM });

    paint(h(ProviderIcon, { slug: 'acme', name: 'Acme', size: 20 }));

    const svg = mark();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 32 32');
    // The host still owns the element, so the plugin's mark follows the theme
    // exactly as a built-in one does.
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.innerHTML).toContain('M4 4h24v24H4z');
  });

  test('an unregistered provider is byte-identical to the built-in mark', () => {
    const props = { icon: 'deepseek', slug: 'deepseek', name: 'DeepSeek', size: 15 };
    paint(h(ProviderIcon, props));
    const without = container.innerHTML;

    registerListSlot('demo', 'providerIcon', { id: 'acme', provider: 'acme', glyph: CUSTOM });
    paint(h(ProviderIcon, props));

    expect(container.innerHTML).toBe(without);
    expect(without).toContain(`viewBox="${PROVIDER_GLYPHS.deepseek.viewBox}"`);
  });

  test('a malformed glyph falls through to the built-in mark, not an empty tile', () => {
    registerListSlot('demo', 'providerIcon', { id: 'broken', provider: 'deepseek', glyph: 'nope' });

    paint(h(ProviderIcon, { slug: 'deepseek', name: 'DeepSeek' }));

    expect(mark()?.getAttribute('viewBox')).toBe(PROVIDER_GLYPHS.deepseek.viewBox);
  });

  test('two plugins on one provider resolve to the first row the store merges', () => {
    registerListSlot('beta', 'providerIcon', { id: 'acme', provider: 'acme', glyph: OTHER });
    registerListSlot('alpha', 'providerIcon', { id: 'acme', provider: 'acme', glyph: CUSTOM });

    paint(h(ProviderIcon, { slug: 'acme', name: 'Acme' }));

    // The store sorts by `order`, then plugin id: `alpha` is the deterministic
    // winner, and `beta`'s registration is still accepted, not refused.
    expect(mark()?.getAttribute('viewBox')).toBe('0 0 32 32');
  });

  test('a registration made after mount reaches the icon', async () => {
    paint(h(ProviderIcon, { slug: 'acme', name: 'Acme' }));
    expect(mark()).toBeNull();

    let dispose: () => void = () => {};
    await act(async () => {
      dispose = registerListSlot('demo', 'providerIcon', { id: 'acme', provider: 'acme', glyph: CUSTOM });
    });
    expect(mark()?.getAttribute('viewBox')).toBe('0 0 32 32');

    await act(async () => {
      dispose();
    });
    expect(mark()).toBeNull();
  });

  test('with no plugins an unknown provider still draws its initials', () => {
    paint(h(ProviderIcon, { slug: 'definitely-not-a-provider', name: 'Toktok ID' }));

    expect(mark()).toBeNull();
    expect(container.textContent).toBe('ti.');
  });
});
