/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `modern` workspace header's sticky surface.
 *
 * The header is opaque because rows scroll under it, so the colour it paints is
 * visible as a band behind every folder. It must be the surface the list sits
 * on: `--theme-paper` in the desktop column, `--theme-canvas` in the phone
 * drawer (`shared/lib/theme/chrome.ts`). Shipping one `bg-paper` put a lighter
 * stripe behind each folder on the phone — the reported "belang" list.
 *
 * Rendered with `h()` against happy-dom, following
 * `common/session-row/session-row.test.tsx`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';

import { WorkspaceHeader } from '@/client/components/layout/session-sidebar/modern/WorkspaceHeader';
import type { WorkspaceHeaderProps } from '@/client/components/layout/session-sidebar/modern/WorkspaceHeader';
import type { WorkspaceFolderData } from '@/shared/types';

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

const FOLDER: WorkspaceFolderData = {
  id: 1,
  name: 'kabmo',
  isExpanded: true,
  sessions: [],
  hasMore: false,
  totalSessions: 0,
};

function mount(overrides: Partial<WorkspaceHeaderProps> = {}) {
  if (container) {
    render(null, container);
    container.remove();
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  render(
    h(WorkspaceHeader, {
      folder: FOLDER,
      isOpen: true,
      onToggleFolder: () => {},
      sessionCount: 0,
      checkbox: null,
      batchActive: false,
      menuRef: { current: null },
      showMenu: false,
      onToggleMenu: () => {},
      onNewSession: () => {},
      ...overrides,
    }),
    container,
  );
  return container.firstElementChild as HTMLElement;
}

describe('modern workspace header', () => {
  test('the desktop header paints the column surface', () => {
    const header = mount();
    expect(header.className).toContain('bg-paper');
    expect(header.className).not.toContain('bg-canvas');
  });

  test('the phone header paints the drawer surface, so no folder band appears', () => {
    const header = mount({ touch: true });
    expect(header.className).toContain('bg-canvas');
    expect(header.className).not.toContain('bg-paper');
  });

  test('it stays sticky in both densities', () => {
    expect(mount().className).toContain('sticky');
    expect(mount({ touch: true }).className).toContain('sticky');
  });

  test('the phone header is 32px, the height its rows match', () => {
    expect(mount({ touch: true }).className).toContain('h-8');
    expect(mount().className).toContain('h-[26px]');
  });
});
