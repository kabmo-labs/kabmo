/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one icon-button box shared by a panel header and a settings pane.
 *
 * The box's size is a Tailwind class, so a DOM test cannot measure it; what it
 * CAN pin is the contract every caller relies on: the label names the control
 * for a pointer and a screen reader, `busy` spins the glyph and marks the
 * control busy, disabled reaches the button, and a non-refresh action gets the
 * same box without claiming to be busy.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import type { ComponentChild } from 'preact';
import { act } from 'preact/test-utils';

import { HeaderButton, RefreshButton } from '@/client/components/common/header-button';

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

async function mountButton(node: ComponentChild) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(node, container);
  });
  return container.querySelector('button') as HTMLButtonElement;
}

describe('RefreshButton', () => {
  test('the label names the control for a pointer and a screen reader', async () => {
    const button = await mountButton(
      h(RefreshButton, { label: 'Refresh todos', onClick: () => {} }),
    );
    expect(button.getAttribute('title')).toBe('Refresh todos');
    expect(button.getAttribute('aria-label')).toBe('Refresh todos');
  });

  test('busy spins the glyph and marks the control busy', async () => {
    const button = await mountButton(
      h(RefreshButton, { label: 'Refresh', onClick: () => {}, busy: true }),
    );
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
  });

  test('disabled reaches the button', async () => {
    const button = await mountButton(
      h(RefreshButton, { label: 'Refresh', onClick: () => {}, disabled: true }),
    );
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});

describe('HeaderButton', () => {
  test('a view action shares the same box as the refresh', async () => {
    const button = await mountButton(
      h(HeaderButton, { label: 'Kill this shell', onClick: () => {}, children: h('svg', null) }),
    );
    expect(button.className).toContain('p-1.5');
    expect(button.className).toContain('rounded-md');
    // No rectangle around the glyph: the header's reload is the glyph and a
    // hover tint, not a bordered control.
    expect(button.className).not.toContain('border');
    expect(button.getAttribute('aria-busy')).toBeNull();
  });
});
