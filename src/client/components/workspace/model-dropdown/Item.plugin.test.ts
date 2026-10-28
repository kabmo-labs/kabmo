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

describe('composer row: provider mark and text grid', () => {
  /** The row's plate — the fixed box that keeps every name at one x. */
  function plate(): HTMLElement | null {
    return container.querySelector('[role="button"] > div > span[aria-hidden]');
  }

  test('the provider mark sits on a fixed plate, so names share a left edge', () => {
    mount({ id: 'v3', name: 'DeepSeek V3', provider: 'DeepSeek', providerIcon: 'deepseek' });

    const box = plate();
    expect(box).not.toBeNull();
    expect(box?.style.width).toBe('18px');
    expect(box?.style.height).toBe('18px');
  });

  test('a fetched web icon is drawn in colour on that plate', () => {
    // The composer is the surface a user stares at; a provider whose site logo
    // was fetched must not show initials here while Settings shows the logo.
    mount({
      id: 'v3',
      name: 'DeepSeek V3',
      provider: 'DeepSeek',
      providerIconUrl: '/api/provider-icon?slug=deepseek&v=1700000000000',
    });

    const image = plate()?.querySelector('img') as HTMLImageElement | null;
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe('/api/provider-icon?slug=deepseek&v=1700000000000');
    expect(image?.className).toContain('object-contain');
  });

  test('the model name takes the slack and the context badge is a fixed column', () => {
    mount({ id: 'v3', name: 'DeepSeek V3', provider: 'DeepSeek', contextWindow: 200000 });

    const name = container.querySelector('[role="button"] span[title="DeepSeek V3"]') as HTMLElement;
    expect(name.className).toContain('flex-1');
    expect(name.className).toContain('truncate');
    const context = name.nextElementSibling as HTMLElement;
    expect(context.className).toContain('w-11');
    expect(context.className).toContain('text-right');
    expect(context.className).toContain('tabular-nums');
  });

  test('a row with no context window keeps the column, so the names still align', () => {
    mount({ id: 'v3', name: 'DeepSeek V3', provider: 'DeepSeek' });

    const name = container.querySelector('[role="button"] span[title="DeepSeek V3"]') as HTMLElement;
    const context = name.nextElementSibling as HTMLElement;
    expect(context.textContent).toBe('');
    expect(context.className).toContain('w-11');
  });
});

describe('composer row: the context column is pinned', () => {
  test('the right cluster is a fixed width, so a check or a pill cannot move it', () => {
    // Measured in the browser before this: the context badge sat at x=572 on 94
    // rows and x=547 on the one selected row, whose checkmark and wider thinking
    // label grew the right cluster by 25px.
    mount({ id: 'v3', name: 'DeepSeek V3', provider: 'DeepSeek', contextWindow: 128000, thinkingLevel: 'auto' });

    const right = container.querySelector('[role="button"] > div:last-child') as HTMLElement;
    expect(right.className).toContain('w-[100px]');
    expect(right.className).toContain('justify-end');
  });
});
