/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared workspace panel header.
 *
 * The strip's height is a Tailwind class, so a DOM test cannot measure it; what
 * it CAN pin is the contract the views rely on: both slots are drawn, the right
 * cluster disappears when a view has no actions, and a caller's class lands on
 * the strip (Files passes `border-b-0` because its filter row follows inside the
 * same bordered block).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import type { ComponentChildren } from 'preact';
import { act } from 'preact/test-utils';

import { PanelHeader } from '@/client/components/workspace/panel-header';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
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
  render(null, container);
  container.remove();
});

async function mount(left: ComponentChildren, right?: ComponentChildren, className?: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(PanelHeader, { left, right, className }), container);
  });
  return container;
}

describe('PanelHeader', () => {
  test('draws the leading and trailing slots', async () => {
    const el = await mount(h('span', null, 'picker'), h('button', null, 'refresh'));
    expect(el.textContent).toContain('picker');
    expect(el.textContent).toContain('refresh');
  });

  test('a view with no actions draws no trailing cluster', async () => {
    const el = await mount(h('span', null, 'picker'));
    expect(el.textContent).toBe('picker');
    const strip = el.firstElementChild as HTMLElement;
    expect(strip.children).toHaveLength(1);
  });

  test('the caller class lands on the strip', async () => {
    const el = await mount(h('span', null, 'picker'), undefined, 'border-b-0');
    const strip = el.firstElementChild as HTMLElement;
    expect(strip.className).toContain('border-b-0');
    expect(strip.className).toContain('h-10');
  });
});
