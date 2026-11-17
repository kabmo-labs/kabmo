/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A SEARCH keeps the reveal control.
 *
 * The reported defect: typing a query that matched dozens of sessions drew five
 * rows and no "Show more" control. The cause was two rules that were each
 * reasonable alone — the search force-expands the folder (so the reveal row was
 * hidden) and the list is windowed to five for height — and together they made
 * the rest of the matches unreachable.
 *
 * The window stays (a 451-row result must not be one wall of rows), and the
 * reveal row is now drawn in search mode too: `N more` reveals the next page,
 * `Less` collapses back to the first five.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';

import { Category } from '@/client/components/layout/session-sidebar/CategoryItem';
import type { SessionItemData, WorkspaceFolderData } from '@/shared/types';

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  container = document.createElement('div');
  document.body.appendChild(container);
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
});

function sessions(count: number): SessionItemData[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    folder_id: 7,
    title: `session ${index}`,
    is_archived: 0,
    updated_at: `2026-01-0${(index % 9) + 1}T00:00:00`,
  })) as SessionItemData[];
}

function folder(count: number): WorkspaceFolderData {
  return {
    id: 7,
    name: 'kabmo',
    isExpanded: true,
    sessions: sessions(count),
    hasMore: false,
    totalSessions: count,
  } as WorkspaceFolderData;
}

function mount(count: number, forceExpanded: boolean): void {
  render(
    h(Category, {
      folder: folder(count),
      activeSessionId: null,
      onSelectSession: () => {},
      onNewSessionForFolder: () => {},
      forceExpanded,
    }),
    container,
  );
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button'))
    .find((entry) => (entry.textContent ?? '').includes(label)) as HTMLButtonElement | undefined;
}

describe('session search results', () => {
  test('a search windows its matches and offers the reveal control', () => {
    mount(8, true);
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(5);
    expect(button('Show more sessions (3)')).toBeDefined();
  });

  test('revealing shows the rest, and Less collapses back to the first page', async () => {
    mount(8, true);
    button('Show more sessions (3)')!.click();
    await Bun.sleep(0);
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(8);
    expect(button('Show more sessions')).toBeUndefined();

    button('Show less')!.click();
    await Bun.sleep(0);
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(5);
  });

  test('the ordinary list paginates the same way', () => {
    mount(8, false);
    expect(container.querySelectorAll('[data-testid="session-item"]')).toHaveLength(5);
    expect(button('Show more sessions (3)')).toBeDefined();
  });
});
