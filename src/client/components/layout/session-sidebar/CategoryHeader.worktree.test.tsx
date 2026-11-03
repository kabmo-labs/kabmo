/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The folder header's `New worktree…` entry.
 *
 * This row is the ONLY entry point to the dialog on the desktop, and it is
 * reachable through four components (SessionsView → SessionList → Category →
 * CategoryHeader). The prop is optional at every hop, so a hop that forgets to
 * forward it fails silently: the typechecker is satisfied, the menu renders, and
 * the row is simply absent. Measured — that is exactly how the desktop half
 * shipped unreachable while the phone's worked.
 *
 * The header is mounted directly here, which is the half that can be asserted
 * cheaply; the assembled path is what `tests/e2e/specs/worktree.e2e.ts` covers.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { CategoryHeader } from '@/client/components/layout/session-sidebar/CategoryHeader';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { WorkspaceFolderData } from '@/shared/types';

const folder: WorkspaceFolderData = {
  id: 7,
  name: 'kabmo',
  project_path: '/Users/dev/kabmo',
  isExpanded: true,
  hasMore: false,
  totalSessions: 0,
  sessions: [],
};

let host: HTMLElement | null = null;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = null;
  }
});

afterAll(() => {
  restoreDomGlobals();
});

/**
 * Mount the header, then open its `⋯` menu the way a user does.
 *
 * The menu panel is PORTALLED to `document.body` (the row is inside the
 * sidebar's scroller, and an `absolute` menu was clipped at its edge), so it can
 * no longer be rendered by handing `showMenu: true` to a header that was never
 * clicked: the panel is placed from the TRIGGER's measured rectangle, which
 * only exists once that button has been pressed.
 */
function mountHeader(overrides: Partial<Parameters<typeof CategoryHeader>[0]> = {}): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  render(
    h(CategoryHeader, {
      folder,
      isOpen: true,
      onToggleFolder: () => {},
      checkbox: null,
      batchActive: false,
      showMenu: true,
      onToggleMenu: () => {},
      onCloseMenu: () => {},
      onNewSession: () => {},
      confirmDelete: false,
      onPin: () => {},
      onDelete: () => {},
      onRequestDelete: () => {},
      onCancelDelete: () => {},
      ...overrides,
    }),
    host,
  );
  return host;
}

/** Press the row's `⋯` trigger, which is what mounts the portalled menu. */
async function openMenu(host: HTMLElement): Promise<void> {
  const trigger = host.querySelector('button[aria-label^="Options for"]') as HTMLButtonElement | null;
  if (!trigger) throw new Error('no options trigger rendered');
  await act(async () => {
    trigger.click();
  });
}

/** The menu's own buttons, by their words — read from the document it portals into. */
function menuRows(): string[] {
  return [...document.body.querySelectorAll('[aria-label^="Options for"] button')]
    .map((button) => (button.textContent ?? '').trim())
    .filter(Boolean);
}

describe('CategoryHeader worktree entry', () => {
  test('the menu offers New worktree… when a handler is supplied', async () => {
    await openMenu(mountHeader({ onNewWorktreeSession: () => {} }));
    expect(menuRows()).toContain('New worktree…');
  });

  test('no row without a handler — a folder that cannot create one does not offer it', async () => {
    await openMenu(mountHeader());
    expect(menuRows().some((row) => row.startsWith('New worktree'))).toBe(false);
  });

  test('a folder with no project path offers nothing: a worktree needs a repository', async () => {
    await openMenu(mountHeader({
      folder: { ...folder, project_path: null },
      onNewWorktreeSession: () => {},
    }));
    expect(menuRows().some((row) => row.startsWith('New worktree'))).toBe(false);
  });

  test('clicking it opens the dialog, closed on its own name field', async () => {
    await openMenu(mountHeader({ onNewWorktreeSession: () => {} }));
    const row = [...document.body.querySelectorAll<HTMLButtonElement>('[aria-label^="Options for"] button')].find(
      (button) => (button.textContent ?? '').trim() === 'New worktree…',
    );
    if (!row) throw new Error('no New worktree row rendered');

    await act(async () => {
      row.click();
    });

    // The dialog names the project it will branch from, and starts on a
    // generated branch with its folder following it.
    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Start from');
    expect(text).toContain('kabmo');
    const branch = (document.body.querySelector('input') as HTMLInputElement | null)?.value ?? '';
    expect(branch).toMatch(/^wt\/[a-z]+-[a-z]+$/);
  });
});