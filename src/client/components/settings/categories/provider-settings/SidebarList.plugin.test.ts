/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The settings provider list is one of the surfaces a plugin's `providerIcon`
 * registration must reach.
 *
 * The list draws every row through `ProviderIcon`, so the assertions are the
 * slot's contract at a real call site: the registered mark appears for the
 * provider it names, and the neighbouring provider keeps its built-in mark.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ProviderSidebarList } from '@/client/components/settings/categories/provider-settings/SidebarList';
import { PROVIDER_GLYPHS } from '@/client/components/common/provider-icon/glyphs';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import type { ProviderItem } from '@/shared/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const CUSTOM = '<svg viewBox="0 0 32 32"><path d="M4 4h24v24H4z"/></svg>';

const deepseek: ProviderItem = {
  id: 'p1', name: 'DeepSeek', slug: 'deepseek', icon: 'deepseek',
  status: 'connected', configuredIn: 'api key', models: [],
};
const openai: ProviderItem = {
  id: 'p2', name: 'OpenAI', slug: 'openai', icon: 'openai',
  status: 'connected', configuredIn: 'api key', models: [],
};

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

function mount(providers: ProviderItem[]): void {
  act(() => {
    render(
      h(ProviderSidebarList, {
        providers,
        selectedProviderId: providers[0]?.id ?? '',
        onSelectProvider: () => {},
        onOpenAddModal: () => {},
        onRefresh: () => {},
        isRefreshing: false,
        isLoading: false,
      }),
      container,
    );
  });
}

/** Every provider mark in the list, in row order. The component fills its svg
 *  with `currentColor`; the Lucide icons paint with `fill="none"`. */
function marks(): string[] {
  return [...container.querySelectorAll('svg[fill="currentColor"]')].map(
    (svg) => svg.getAttribute('viewBox') ?? '',
  );
}

describe('provider-settings list and the providerIcon slot', () => {
  test('a registered mark renders for its provider and no other row', () => {
    registerListSlot('demo', 'providerIcon', { id: 'ds', provider: 'deepseek', glyph: CUSTOM });

    mount([deepseek, openai]);

    expect(marks()).toEqual(['0 0 32 32', PROVIDER_GLYPHS.openai.viewBox]);
  });

  test('with no plugins every row keeps its built-in mark', () => {
    mount([deepseek, openai]);

    expect(marks()).toEqual([PROVIDER_GLYPHS.deepseek.viewBox, PROVIDER_GLYPHS.openai.viewBox]);
  });
});
