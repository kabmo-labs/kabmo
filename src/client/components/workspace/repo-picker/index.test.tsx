/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The picker's dropdown and the door to the modal.
 *
 * The load-bearing half is the ENTRY: the dropdown is 352px wide with a 192px
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

async function mount(repos: string[], activeRepo = '.'): Promise<void> {
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
        activeRepo,
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

/**
 * The dropdown list itself. Portaled to `<body>`, not inside the picker's own
 * box: the right panel clips its children, and the list must be able to be
 * wider than a 268px Source Control column.
 */
function menu(): HTMLElement {
  return document.querySelector('[role="listbox"]') as HTMLElement;
}

describe('GitRepoPicker', () => {
  test('names the active repo in the trigger', async () => {
    await mount(['.']);
    expect(trigger().textContent).toContain('Workspace');
  });

  test('names the selected repo before discovery has listed it', async () => {
    // A reload starts discovery from scratch: the topic answers `['.']` until
    // the walk finishes, while the session still holds the nested pick. Looking
    // the selection up from the rows alone drew the workspace root — the PARENT
    // folder, labelled with the workspace's own name — as if that were the
    // chosen repository, and the repo the panel was reading was not even listed.
    await mount(['.'], 'projects/a/token');
    expect(trigger().textContent).toContain('token');
    expect(trigger().textContent).not.toContain('Workspace');

    await act(async () => {
      trigger().click();
    });
    const active = menu().querySelector('button[aria-selected="true"]') as HTMLButtonElement | null;
    expect(active?.textContent).toContain('projects/a/token');
    // The root row is still a real choice beside it.
    const rootRow = [...document.querySelectorAll('button[role="option"]')].find(
      (b) => b.textContent?.trim() === 'Workspace',
    );
    expect(rootRow).toBeDefined();

    await act(async () => {
      active?.click();
    });
    expect(selections).toEqual(['projects/a/token']);
  });

  test('offers the root row when discovery found only nested repos', async () => {
    // A workspace root that is a folder of nested repos is not itself a repo,
    // so discovery omits `'.'`. The root is still a legitimate scope, and the
    // trigger must name it rather than the first nested repo the panel is not
    // showing.
    await mount(['projects/a/token']);
    expect(trigger().textContent).toContain('Workspace');
    await act(async () => {
      trigger().click();
    });
    const rootRow = [...document.querySelectorAll('button[role="option"]')].find(
      (b) => b.textContent?.trim() === 'Workspace',
    );
    expect(rootRow).toBeDefined();
    await act(async () => {
      (rootRow as HTMLButtonElement | undefined)?.click();
    });
    expect(selections).toEqual(['.']);
  });

  test('opens a list that selects on click', async () => {
    await mount(['.', 'projects/a/token']);
    await act(async () => {
      trigger().click();
    });
    const row = [...menu().querySelectorAll('button')].find((b) => b.textContent?.includes('projects/a/token'));
    expect(row).toBeDefined();
    await act(async () => {
      row?.click();
    });
    expect(selections).toEqual(['projects/a/token']);
  });

  test('the list is portaled and wider than the old 224px cap', async () => {
    // The right panel clips its children and its Source Control floor is 268px,
    // so a list left inside the trigger is cut off the moment it is widened.
    // The portal is what lets one width serve both a narrow panel and a full
    // nested path (`projects/jns6_5/token` is 22 characters).
    await mount(['.', 'projects/jns6_5/token']);
    await act(async () => {
      trigger().click();
    });
    const list = menu();
    expect(container.contains(list)).toBe(false);
    expect(document.body.contains(list)).toBe(true);
    expect(Number.parseFloat(list.style.width)).toBeGreaterThan(224);
  });

  test('offers the manage entry, and opening it closes the dropdown', async () => {
    await mount(['.', 'projects/a/token']);
    await act(async () => {
      trigger().click();
    });
    const manage = [...menu().querySelectorAll('button')].find((b) =>
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
    expect(document.querySelector('input[placeholder="Search repos..."]')).toBeNull();
  });

  test('the filter narrows the dropdown list', async () => {
    await mount(['.', 'alpha', 'beta']);
    await act(async () => {
      trigger().click();
    });
    const input = menu().querySelector('input[title="Search repositories"]') as HTMLInputElement;
    await act(async () => {
      input.value = 'alpha';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    for (let i = 0; i < 5; i += 1) await act(async () => {});
    expect(menu().textContent).toContain('alpha');
    expect(menu().textContent).not.toContain('beta');
  });
});
