/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The header is the modal's only chrome: the mode switch, the filter and the
 * close control. These mounts pin the parts a screen reader and a keyboard
 * user depend on, plus the copy that changes with the mode.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Header } from '@/client/components/workspace/git-panel/commit-modal/Header';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

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

async function mount(isGraphMode: boolean): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(Header, {
        isGraphMode,
        onToggleMode: () => {},
        searchQuery: '',
        onSearchChange: () => {},
        onRefresh: () => {},
        onClose: () => {},
        totalCommits: 50,
        loadedCount: 50,
        totalCount: 1815,
        hasMore: true,
      }),
      container
    );
  });
  return container;
}

describe('commit modal header', () => {
  test('history mode names the page and its subtitle', async () => {
    const el = await mount(false);
    expect(el.textContent).toContain('History');
    expect(el.textContent).toContain('Browse recent commits and inspect changed files.');
  });

  test('graph mode names the page and its subtitle', async () => {
    const el = await mount(true);
    expect(el.textContent).toContain('Graph');
    expect(el.textContent).toContain('Follow branch topology and inspect commits.');
  });

  test('the mode buttons report which view is active', async () => {
    const history = await mount(false);
    expect(history.querySelector('button[aria-label="History view"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(history.querySelector('button[aria-label="Graph view"]')?.getAttribute('aria-pressed')).toBe('false');

    const graph = await mount(true);
    expect(graph.querySelector('button[aria-label="History view"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(graph.querySelector('button[aria-label="Graph view"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('the filter and the close control have accessible names', async () => {
    const el = await mount(false);
    expect(el.querySelector('input[aria-label="Filter commits"]')).toBeTruthy();
    expect(el.querySelector('button[aria-label="Close commit history"]')).toBeTruthy();
    expect(el.querySelector('button[aria-label="Refresh commit history"]')).toBeTruthy();
  });
});
