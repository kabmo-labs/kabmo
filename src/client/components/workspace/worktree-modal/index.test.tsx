/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The New worktree dialog, rendered.
 *
 * Three rules here are the ones a reader would otherwise discover in a browser
 * and nowhere else:
 *
 *  - the generated branch is in the FIRST paint (before any effect flushes),
 *    because the window between paint and the effect is exactly when a user
 *    types — measured: a field filled with `main` was replaced by the generated
 *    name and the dialog created `wt/calm-iguana` instead of reporting that
 *    `main` is taken;
 *  - the folder follows the branch, so it is never named after a previous one;
 *  - a closed dialog renders nothing at all, so no field is focusable while it
 *    is shut.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { NewWorktreeModal } from '@/client/components/workspace/worktree-modal/index';

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
 * microtask, so a `useEffect` that seeds a field has not run when `render`
 * returns — reading the inputs then reads empty ones, which is a property of the
 * test harness and not of the dialog.
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

function textOf(host: HTMLElement): string {
  return (host.textContent ?? '').replace(/\s+/g, ' ').trim();
}

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

  test('the generated branch is in the FIRST paint, before any effect flushes', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Deliberately NOT `mount`: no `act`, so no effect has run. A field seeded
    // by an effect reads empty here, and the browser's own window between paint
    // and the effect flush is exactly when a user types into it.
    render(
      h(NewWorktreeModal, { isOpen: true, onClose: () => {}, root: '/repo', folderId: 1, folderName: 'kabmo', onCreated: () => {} }),
      host,
    );
    mounted.push(host);

    const inputs = [...host.querySelectorAll('input')] as HTMLInputElement[];
    const branch = inputs[0]?.value ?? '';
    expect(branch).toMatch(/^wt\/[a-z]+-[a-z]+$/);
    // One generated name for both fields: deriving the folder from a SECOND
    // call would show a folder the branch does not have.
    expect(inputs[2]?.value ?? '').toBe(branch.replace(/^wt\//, ''));
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
