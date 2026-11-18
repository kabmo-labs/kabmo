/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `modern` sidebar's search line.
 *
 * The field draws its own clear control, so it must opt out of the engine's:
 * `type="search"` makes WebKit and Blink paint `::-webkit-search-cancel-button`
 * inside the input, and the sidebar then showed two X's — the native one beside
 * the app's labelled button. The DOM cannot show the native glyph, so the
 * contract asserted here is the one that suppresses it: the input carries
 * `kabmo-search-field` (the rule in `tailwind.css`) and the app's button is the
 * only clear control in the field.
 *
 * Rendered with `h()` against happy-dom, following `modern/reveal-row.test.tsx`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';

import { SearchField } from '@/client/components/layout/session-sidebar/modern/SearchField';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

function mount(props: { value: string; onChange?: (value: string) => void; touch?: boolean }) {
  if (container) {
    render(null, container);
    container.remove();
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  render(h(SearchField, { onChange: () => {}, ...props }), container);
  return container.querySelector('input') as HTMLInputElement;
}

const buttons = () => Array.from(container.querySelectorAll('button'));

describe('modern sidebar search field', () => {
  test('the input opts out of the engine clear control', () => {
    const input = mount({ value: '' });
    expect(input.type).toBe('search');
    expect(input.classList.contains('kabmo-search-field')).toBe(true);
  });

  test('an empty field has no clear control at all', () => {
    mount({ value: '' });
    expect(buttons()).toHaveLength(0);
  });

  test('a query leaves exactly one clear control, and it is the app\'s', () => {
    mount({ value: 'kabmo' });
    const clear = buttons();
    expect(clear).toHaveLength(1);
    expect(clear[0]!.getAttribute('aria-label')).toBe('Clear search');
  });

  test('the clear control empties the query', () => {
    const seen: string[] = [];
    mount({ value: 'kabmo', onChange: (value) => seen.push(value) });
    buttons()[0]!.click();
    expect(seen).toEqual(['']);
  });

  test('the touch variant keeps the same single clear control', () => {
    mount({ value: 'kabmo', touch: true });
    expect(buttons()).toHaveLength(1);
  });
});
