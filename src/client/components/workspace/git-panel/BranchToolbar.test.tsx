/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Sync button's spinner contract.
 *
 * The button carries the ahead/behind counts and a pull+push can run for
 * seconds; a static `RefreshCw` made it look unpressed. `syncing` is derived
 * from the ACTION, not from `isBusy` — `isBusy` also covers the status read and
 * every other mutation, and a commit must not spin this badge.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { GitBranchToolbar } from '@/client/components/workspace/git-panel/BranchToolbar';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
let syncClicks: number;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
});

afterAll(() => {
  restoreDomGlobals();
});

function mount({ syncing = false, isBusy = false }: { syncing?: boolean; isBusy?: boolean } = {}): void {
  syncClicks = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(
      h(GitBranchToolbar, {
        branchRef: { current: null },
        showBranchMenu: false,
        setShowBranchMenu: () => {},
        branch: 'main',
        branches: ['main'],
        remoteBranches: [],
        onCheckout: () => {},
        onMerge: () => {},
        onOpenBranchPrompt: () => {},
        onManageBranches: () => {},
        optionsRef: { current: null },
        showOptions: false,
        setShowOptions: () => {},
        onHistory: () => {},
        onGraph: () => {},
        viewMode: 'flat',
        setViewMode: () => {},
        isBusy,
        syncCount: { ahead: 2, behind: 1 },
        syncing,
        onSync: () => {
          syncClicks += 1;
        },
        onFetch: () => {},
      }),
      container,
    );
  });
}

function syncButton(): HTMLButtonElement {
  const el = container.querySelector('button[aria-label="Sync with upstream"]');
  if (!el) throw new Error('no Sync button rendered');
  return el as HTMLButtonElement;
}

describe('GitBranchToolbar Sync spinner', () => {
  test('idle: no rotation, counts still printed', () => {
    mount();

    const button = syncButton();
    expect(button.querySelector('svg.animate-spin')).toBeNull();
    expect(button.getAttribute('aria-busy')).not.toBe('true');
    expect(button.textContent).toContain('↑2');
    expect(button.textContent).toContain('↓1');
  });

  test('syncing: the SAME glyph rotates — the icon is not swapped', () => {
    mount();
    const idleGlyph = syncButton().querySelector('svg')?.innerHTML;
    render(null, container);
    container.remove();

    mount({ syncing: true });
    const spinning = syncButton().querySelector('svg');
    expect(spinning).not.toBeNull();
    expect(spinning!.classList.contains('animate-spin')).toBe(true);
    // Rotating one glyph is the point: a swap would change the paths, and a
    // different mark makes the control look like it changed identity mid-press.
    expect(spinning!.innerHTML).toBe(idleGlyph ?? '');
    expect(syncButton().getAttribute('aria-busy')).toBe('true');
    expect(syncButton().getAttribute('title')).toBe('Syncing with upstream…');
    // The counts stay visible — the spin marks the ACTION, the numbers mark
    // how much work it covers.
    expect(syncButton().textContent).toContain('↑2');
    expect(syncButton().textContent).toContain('↓1');
  });

  test('clicking dispatches onSync', () => {
    mount();

    act(() => {
      syncButton().click();
    });

    expect(syncClicks).toBe(1);
  });

  test('busy disables the button', () => {
    mount({ isBusy: true, syncing: true });

    expect(syncButton().disabled).toBe(true);
  });
});