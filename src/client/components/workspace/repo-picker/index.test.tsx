/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The picker's dropdown and the door to the modal.
 *
 * The load-bearing half is the ENTRY: the dropdown is 208px wide with a 192px
 * scroll area, and the whole point of the modal is that a workspace with dozens
 * of repositories cannot be managed from there. An entry that renders but does
 * not open the modal leaves the feature unreachable — and one that leaves the
 * dropdown open behind the modal puts two lists on screen at once.
 *
 * Rendered with `h()` against happy-dom; the modal's own read is stubbed so
 * opening it does not reach the network.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
// The app loads `preact/compat`, which binds `onChange` on an input to the
// `input` event; a harness without it would type into a field the real app
// listens to a different event on.
import 'preact/compat';
import { GitRepoPicker } from '@/client/components/workspace/repo-picker';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const ROOT = '/ws/Workspace';
const nativeFetch = Bun.fetch;

let container: HTMLElement;
/** Repos the picker was handed. */
let selections: string[];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  selections = [];
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
});

afterAll(() => {
  restoreDomGlobals();
});

async function mount(repos: string[]): Promise<void> {
  (globalThis as unknown as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify({ success: true, details: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(GitRepoPicker, {
        rootPath: ROOT,
        activeRepo: '.',
        onSelectRepo: (repo: string) => selections.push(repo),
        repos,
        scanning: false,
        onRefreshRepos: () => {},
      }),
      container,
    );
  });
}

/** The dropdown trigger, by the title the picker gives it. */
function trigger(): HTMLButtonElement {
  return container.querySelector('button[title="Switch git project"]') as HTMLButtonElement;
}

describe('GitRepoPicker', () => {
  test('names the active repo in the trigger', async () => {
    await mount(['.']);
    expect(trigger().textContent).toContain('Workspace');
  });

  test('opens a list that selects on click', async () => {
    await mount(['.', 'projects/a/token']);
    await act(async () => {
      trigger().click();
    });
    const row = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('projects/a/token'));
    expect(row).toBeDefined();
    await act(async () => {
      row?.click();
    });
    expect(selections).toEqual(['projects/a/token']);
  });

  test('offers the manage entry, and opening it closes the dropdown', async () => {
    await mount(['.', 'projects/a/token']);
    await act(async () => {
      trigger().click();
    });
    const manage = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Manage repositories'),
    );
    expect(manage).toBeDefined();

    await act(async () => {
      manage?.click();
    });
    for (let i = 0; i < 5; i += 1) await act(async () => {});

    // The modal is up (its own heading), and the dropdown's filter field is
    // gone — two lists on screen at once is what the close exists to prevent.
    expect(container.textContent).toContain('Repositories');
    expect(container.querySelector('input[placeholder="Search repos..."]')).toBeNull();
  });

  test('the filter narrows the dropdown list', async () => {
    await mount(['.', 'alpha', 'beta']);
    await act(async () => {
      trigger().click();
    });
    const input = container.querySelector('input[title="Search repositories"]') as HTMLInputElement;
    await act(async () => {
      input.value = 'alpha';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    for (let i = 0; i < 5; i += 1) await act(async () => {});
    expect(container.textContent).toContain('alpha');
    expect(container.textContent).not.toContain('beta');
  });
});
