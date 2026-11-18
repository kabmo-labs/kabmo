/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness filter, mounted.
 *
 * The rules that matter are the ones a screenshot cannot show: the control is
 * ABSENT while one agent owns the list (a filter with one choice can only be
 * wrong), and an active filter whose last row disappeared keeps its entry so
 * the list it emptied can be restored. Both are asserted here rather than
 * through the sidebar, which would need a socket to reach the same two states.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { HarnessFilter } from '@/client/components/layout/session-sidebar/HarnessFilter';
import type { HarnessFilterOption } from '@/shared/lib/workspace/harness-filter';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
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

const OPTIONS: HarnessFilterOption[] = [
  { harness: 'omp-rpc', label: 'omp', count: 3 },
  { harness: 'claude', label: 'claude', count: 1 },
];

async function mount(node: preact.ComponentChild) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(node, container);
  });
  return container;
}

/** The trigger is the only button inside the mounted container. */
function trigger(el: HTMLElement): HTMLButtonElement {
  return el.querySelector('button')!;
}

/** A row of the portalled menu, by its visible text. */
function menuRow(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find((button) => (
    button.textContent?.includes(label) && !container.contains(button)
  ));
}

async function openMenu(el: HTMLElement) {
  await act(async () => {
    trigger(el).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('the harness filter', () => {
  test('is absent while one agent owns the list', async () => {
    const el = await mount(h(HarnessFilter, {
      options: [{ harness: 'omp-rpc', label: 'omp', count: 4 }],
      value: null,
      onChange: () => {},
    }));

    expect(el.querySelector('button')).toBeNull();
  });

  test('the trigger names the whole list, and the menu counts each harness', async () => {
    const el = await mount(h(HarnessFilter, { options: OPTIONS, value: null, onChange: () => {} }));

    expect(trigger(el).textContent).toContain('All harnesses');
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false');

    await openMenu(el);
    expect(trigger(el).getAttribute('aria-expanded')).toBe('true');
    expect(menuRow('omp')?.textContent).toContain('3');
    expect(menuRow('claude')?.textContent).toContain('1');
    // The glyph is decoration inside a named row, not a second announcement.
    expect(menuRow('claude')?.querySelector('[data-harness="claude"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  test('picking a harness reports it and closes the menu', async () => {
    const picked: Array<string | null> = [];
    const el = await mount(h(HarnessFilter, {
      options: OPTIONS,
      value: null,
      onChange: (next) => picked.push(next),
    }));

    await openMenu(el);
    await act(async () => {
      menuRow('claude')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(picked).toEqual(['claude']);
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false');
  });

  test('an active filter names itself on the trigger and can be cleared', async () => {
    const picked: Array<string | null> = [];
    const el = await mount(h(HarnessFilter, {
      options: OPTIONS,
      value: 'claude',
      onChange: (next) => picked.push(next),
    }));

    expect(trigger(el).textContent).toContain('claude');
    expect(trigger(el).textContent).toContain('1');

    await openMenu(el);
    await act(async () => {
      menuRow('All harnesses')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(picked).toEqual([null]);
  });

  test('an active filter with no rows left keeps an entry so it can be cleared', async () => {
    const el = await mount(h(HarnessFilter, {
      options: [{ harness: 'omp-rpc', label: 'omp', count: 2 }],
      value: 'claude',
      onChange: () => {},
    }));

    expect(trigger(el).textContent).toContain('claude');
    expect(trigger(el).textContent).toContain('0');

    await openMenu(el);
    expect(menuRow('claude')?.textContent).toContain('0');
  });
});
