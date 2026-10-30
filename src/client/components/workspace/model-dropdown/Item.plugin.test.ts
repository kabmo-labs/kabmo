/**
 * @license
 * SPDX-License-Identifier: MIT
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

function mount(model: AIModelOption, extra: { rowId?: string; showProvider?: boolean } = {}): void {
  act(() => {
    render(
      h(ModelDropdownItem, {
        rowId: extra.rowId ?? `test::${model.provider}:${model.id}`,
        ...(extra.showProvider === undefined ? {} : { showProvider: extra.showProvider }),
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
  /** The fixed context column, which lives in the row's right cluster. */
  function contextColumn(): HTMLElement {
    return container.querySelector('[role="button"] > div:last-child > span.w-11') as HTMLElement;
  }

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
    // The number lives in the RIGHT cluster now, so it is found by its column
    // rather than by sitting next to the name.
    const context = contextColumn();
    expect(context.textContent).toBe('200K');
    expect(context.className).toContain('w-11');
    expect(context.className).toContain('text-right');
    expect(context.className).toContain('tabular-nums');
  });

  test('a row with no context window keeps the column, so the names still align', () => {
    mount({ id: 'v3', name: 'DeepSeek V3', provider: 'DeepSeek' });

    const context = contextColumn();
    expect(context.textContent).toBe('');
    expect(context.className).toContain('w-11');
  });
});

describe('composer row: the trailing cells', () => {
  test('the order is context, thinking, provider, star', () => {
    mount({ id: 'v3', name: 'DeepSeek V3', provider: 'Kenari', contextWindow: 128000, thinkingLevel: 'high' }, { showProvider: true });

    const right = container.querySelector('[role="button"] > div:last-child') as HTMLElement;
    const kinds = [...right.children].map((child) => {
      if (child.tagName === 'BUTTON') {
        return (child.getAttribute('title') ?? '').startsWith('Thinking preset') ? 'thinking' : 'star';
      }
      return (child.getAttribute('title') ?? '').startsWith('Provider: ') ? 'provider' : 'context';
    });
    expect(kinds).toEqual(['context', 'thinking', 'provider', 'star']);
  });

  test('the checkmark is gone, and nothing else marks the selection in this cluster', () => {
    // The check cost the cluster its geometry and said nothing the tinted
    // background and the semibold name did not already say.
    act(() => {
      render(
        h(ModelDropdownItem, {
          rowId: 'test::DeepSeek:v3',
          model: { id: 'v3', name: 'DeepSeek V3', provider: 'DeepSeek' },
          isSelected: true,
          isFocused: false,
          onSelect: () => {},
          onToggleFavorite: () => {},
          onMouseEnter: () => {},
        }),
        container,
      );
    });

    const row = container.querySelector('[role="button"]') as HTMLElement;
    expect(row.querySelector('.lucide-check')).toBeNull();
    // Context column + star, and nothing conditional on selection.
    expect(row.querySelectorAll('[role="button"] > div:last-child > *')).toHaveLength(2);
    expect(row.querySelector('[role="button"] span[title="DeepSeek V3"]')?.className).toContain('font-semibold');
    expect(row.className).toContain('bg-ink/5');
  });

  test('a row without a thinking preset keeps the context column where it was', () => {
    mount({ id: 'v3', name: 'DeepSeek V3', provider: 'DeepSeek', contextWindow: 64000 });

    const right = container.querySelector('[role="button"] > div:last-child') as HTMLElement;
    // The context cell is always the FIRST child, so its left edge does not move
    // when the pill or the tag is absent.
    expect(right.firstElementChild?.textContent).toBe('64K');
    expect(right.firstElementChild?.className).toContain('w-11');
  });

  test('the thinking pill is a control, not a label: it stops the click from selecting', () => {
    let selected = 0;
    act(() => {
      render(
        h(ModelDropdownItem, {
          rowId: 'test::DeepSeek:v3',
          model: { id: 'v3', name: 'DeepSeek V3', provider: 'DeepSeek', thinkingLevel: 'high' },
          isSelected: false,
          isFocused: false,
          onSelect: () => { selected += 1; },
          onToggleFavorite: () => {},
          onMouseEnter: () => {},
        }),
        container,
      );
    });

    const pill = container.querySelector('button[title^="Thinking preset"]') as HTMLElement;
    const view = container.ownerDocument.defaultView as unknown as {
      Event: new (type: string, init: { bubbles: boolean }) => Event;
    };
    act(() => {
      pill.dispatchEvent(new view.Event('click', { bubbles: true }));
    });
    expect(selected).toBe(0);
  });
});
