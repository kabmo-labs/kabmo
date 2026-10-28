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

/** Mount the header with its `⋯` menu already open. */
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
      menuRef: { current: null },
      showMenu: true,
      onToggleMenu: () => {},
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

/** The menu's own buttons, by their words. */
function menuRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button')].map((button) => (button.textContent ?? '').trim()).filter(Boolean);
}

describe('CategoryHeader worktree entry', () => {
  test('the menu offers New worktree… when a handler is supplied', () => {
    const container = mountHeader({ onNewWorktreeSession: () => {} });
    expect(menuRows(container)).toContain('New worktree…');
  });

  test('no row without a handler — a folder that cannot create one does not offer it', () => {
    const container = mountHeader();
    expect(menuRows(container).some((row) => row.startsWith('New worktree'))).toBe(false);
  });

  test('a folder with no project path offers nothing: a worktree needs a repository', () => {
    const container = mountHeader({
      folder: { ...folder, project_path: null },
      onNewWorktreeSession: () => {},
    });
    expect(menuRows(container).some((row) => row.startsWith('New worktree'))).toBe(false);
  });

  test('clicking it opens the dialog, closed on its own name field', async () => {
    const container = mountHeader({ onNewWorktreeSession: () => {} });
    const row = [...container.querySelectorAll('button')].find(
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