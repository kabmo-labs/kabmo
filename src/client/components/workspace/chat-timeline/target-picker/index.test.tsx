/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer's target picker and the New Worktree dialog, rendered.
 *
 * Unit-testing markup is usually a test of the test, so these cases are the ones
 * a reader would otherwise discover in a browser and nowhere else:
 *
 *  - the trigger names the WORKTREE when one is picked, because "kabmo" alone
 *    would be equally true of the checkout it is not running in;
 *  - the menu's groups are the three the plan names, and creating is offered
 *    ABOVE the list so a long list cannot hide it;
 *  - the dialog opens on a generated branch with the folder following it, and
 *    the folder keeps following until it is edited (the defect this rule
 *    prevents: a folder named after the previous branch).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { TargetPicker, targetLabel } from '@/client/components/workspace/chat-timeline/target-picker/index';
import { NewWorktreeModal } from '@/client/components/workspace/worktree-modal/index';
import type { WorkspaceFolderData } from '@/shared/types';

const folder: WorkspaceFolderData = {
  id: 1,
  name: 'kabmo',
  project_path: '/repo',
  isExpanded: true,
  hasMore: false,
  totalSessions: 0,
  sessions: [],
};

const nativeFetch = Bun.fetch;
const mounted: HTMLElement[] = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  for (const host of mounted.splice(0)) {
    render(null, host);
    host.remove();
  }
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

/**
 * Mount, with the first render FLUSHED. Preact batches a state update into a
 * microtask, so a `useEffect` that seeds a field (the dialog's generated branch)
 * has not run when `render` returns — reading the inputs then reads empty ones,
 * which is a property of the test harness and not of the dialog.
 */
async function mount(node: h.JSX.Element): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(node, host);
  });
  mounted.push(host);
  return host;
}

/** The picker reads the worktree list on open; answer it without a server. */
/** Calls the picker made, so a test can tell "not read" from "read empty". */
let fetchCalls: string[] = [];

function stubWorktreeList(worktrees: unknown[] = []): void {
  fetchCalls = [];
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    // A plain envelope, not a real `Response`: `Response.json()` resolves on a
    // stream tick that this harness has no reason to wait for, and the picker
    // only reads `ok` and `json()`.
    const payload = { worktrees, base: '/data/worktrees/x', isRepo: true };
    return { ok: true, json: async () => payload } as unknown as Response;
  };
}

/** Collapsed whitespace: the markup carries newlines the reader never sees. */
function textOf(host: HTMLElement): string {
  return (host.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('targetLabel', () => {
  test('the folder alone when the chat runs in the checkout', () => {
    expect(targetLabel([folder], 1, null)).toBe('kabmo');
  });

  test('folder · worktree when a worktree is picked', () => {
    expect(targetLabel([folder], 1, { folderId: 1, worktreePath: '/data/worktrees/abc/cosmic-dolphin' })).toBe(
      'kabmo · cosmic-dolphin',
    );
  });

  test('an unresolved folder still says what it is waiting for', () => {
    expect(targetLabel([], null, null)).toBe('Select Workspace Context');
  });
});

describe('TargetPicker', () => {
  test('the menu offers the project root, both create paths, and the worktree list', async () => {
    stubWorktreeList([
      { path: '/data/worktrees/x/old-one', branch: 'wt/old-one', detached: false, missing: false, isPrimary: false, dirty: 0, aheadOfStart: 0, startRef: 'HEAD', sessions: 0 },
    ]);
    const host = await mount(
      h(TargetPicker, {
        folders: [folder],
        selectedFolderId: 1,
        setSelectedFolderId: () => {},
        target: null,
        setTarget: () => {},
      }),
    );

    const trigger = host.querySelector('button');
    expect(trigger?.textContent).toContain('kabmo');
    await act(async () => {
      (trigger as HTMLButtonElement).click();
    });
    // The list is read when the menu opens; each empty `act` drains one round of
    // the fetch's promise chain, the same way the stash section's suite does.
    for (let round = 0; round < 10; round += 1) await act(async () => {});

    const text = textOf(host);
    expect(text).toContain('Project root');
    expect(text).toContain('Quick worktree');
    expect(text).toContain('New worktree…');
    expect(text).toContain('Worktrees');
    // Creating sits above the LIST: a workspace with many worktrees must not
    // push the action that makes one out of sight. Compared against a listed
    // branch, because the group heading is also spelled "Worktrees".
    expect(fetchCalls.length).toBeGreaterThan(0);
    expect(text).toContain('wt/old-one');
    expect(text.indexOf('Quick worktree')).toBeLessThan(text.indexOf('wt/old-one'));
  });

  test('the trigger shows the picked worktree, not just the folder', async () => {
    const host = await mount(
      h(TargetPicker, {
        folders: [folder],
        selectedFolderId: 1,
        setSelectedFolderId: () => {},
        target: { folderId: 1, worktreePath: '/data/worktrees/abc/cosmic-dolphin' },
        setTarget: () => {},
      }),
    );
    expect(host.querySelector('button')?.textContent).toContain('kabmo · cosmic-dolphin');
  });
});

describe('NewWorktreeModal', () => {
  test('opens on a generated branch, with the folder following it', async () => {
    const host = await mount(
      h(NewWorktreeModal, { isOpen: true, onClose: () => {}, root: '/repo', folderId: 1, folderName: 'kabmo', onCreated: () => {} }),
    );

    const inputs = [...host.querySelectorAll('input')] as HTMLInputElement[];
    const branch = inputs[0]?.value ?? '';
    const folderName = inputs[2]?.value ?? '';
    expect(branch).toMatch(/^wt\/[a-z]+-[a-z]+$/);
    // The folder is the branch without our namespace, so it is never `wt-x`.
    expect(folderName).toBe(branch.replace(/^wt\//, ''));
    expect(folderName.startsWith('wt-')).toBe(false);
  });

  test('states what happens to uncommitted changes, and on which project', async () => {
    const host = await mount(
      h(NewWorktreeModal, { isOpen: true, onClose: () => {}, root: '/repo', folderId: 1, folderName: 'kabmo', onCreated: () => {} }),
    );
    const text = textOf(host);
    expect(text).toContain('Uncommitted changes stay in');
    expect(text).toContain('kabmo');
  });

  test('renders nothing while closed', async () => {
    const host = await mount(
      h(NewWorktreeModal, { isOpen: false, onClose: () => {}, root: '/repo', folderId: 1, onCreated: () => {} }),
    );
    expect(host.textContent).toBe('');
  });
});