/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The batch bar's contract, rendered.
 *
 * Three properties are load-bearing and each is a way a batch delete can go
 * wrong: the bar names the mode's noun (a session batch that says "workspace"
 * deletes the wrong thing), Delete is refused with nothing selected, and
 * Select-all is refused once everything already is — a control that looks
 * available but does nothing is how a user concludes the feature is broken.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { BatchActionBar } from '@/client/components/common/batch-selection/BatchActionBar';
import type { BatchActionBarProps } from '@/client/components/common/batch-selection/BatchActionBar';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
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
  container?.remove();
});

async function mount(overrides: Partial<BatchActionBarProps> = {}) {
  const calls = { selectAll: 0, unselectAll: 0, del: 0, cancel: 0 };
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(BatchActionBar, {
      mode: 'session',
      count: 0,
      total: 3,
      busy: false,
      onSelectAll: () => { calls.selectAll += 1; },
      onUnselectAll: () => { calls.unselectAll += 1; },
      onDelete: () => { calls.del += 1; },
      onCancel: () => { calls.cancel += 1; },
      ...overrides,
    }), container);
  });
  return { el: container, calls };
}

function buttonContaining(el: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(el.querySelectorAll('button'))
    .find((button) => (button.textContent ?? '').includes(text)) as HTMLButtonElement ?? null;
}

describe('BatchActionBar', () => {
  test('counts the selection against the scope, in the mode\'s noun', async () => {
    const { el } = await mount({ count: 2, total: 5, scopeLabel: 'kabmo' });
    expect(el.textContent).toContain('2');
    expect(el.textContent).toContain('of 5 sessions selected');
    expect(el.textContent).toContain('in kabmo');
  });

  test('workspace mode names workspaces and drops the scope clause', async () => {
    const { el } = await mount({ mode: 'workspace', count: 1, total: 4, scopeLabel: 'kabmo' });
    expect(el.textContent).toContain('of 4 workspaces selected');
    expect(el.textContent).not.toContain('in kabmo');
  });

  test('Delete is refused with nothing selected', async () => {
    const { el, calls } = await mount({ count: 0 });
    const del = buttonContaining(el, 'Delete');
    expect(del?.disabled).toBe(true);
    await act(async () => { del?.click(); });
    expect(calls.del).toBe(0);
  });

  test('Delete is enabled with a selection and reports its handler', async () => {
    const { el, calls } = await mount({ count: 2 });
    const del = buttonContaining(el, 'Delete');
    expect(del?.disabled).toBe(false);
    await act(async () => { del?.click(); });
    expect(calls.del).toBe(1);
  });

  test('Select all is refused once everything is selected', async () => {
    const { el } = await mount({ count: 3, total: 3 });
    expect(buttonContaining(el, 'Select all')?.disabled).toBe(true);
  });

  test('Unselect all is refused with nothing selected', async () => {
    const { el } = await mount({ count: 0 });
    expect(buttonContaining(el, 'Unselect all')?.disabled).toBe(true);
  });

  test('both directions are separate controls and both report', async () => {
    const { el, calls } = await mount({ count: 1, total: 3 });
    await act(async () => {
      buttonContaining(el, 'Select all')?.click();
      buttonContaining(el, 'Unselect all')?.click();
    });
    expect(calls.selectAll).toBe(1);
    expect(calls.unselectAll).toBe(1);
  });

  test('a running delete disables every control and says so', async () => {
    const { el } = await mount({ count: 2, busy: true });
    expect(el.textContent).toContain('Deleting…');
    for (const button of Array.from(el.querySelectorAll('button'))) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
