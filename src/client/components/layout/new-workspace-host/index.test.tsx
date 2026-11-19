/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The host that answers the composer's "Add new workspace" request.
 *
 * The picker only dispatches `omp:new-workspace`; this is the other half, and
 * the case a reader would otherwise find only in a browser: the dialog is
 * absent until the event arrives, and Cancel closes it.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { NewWorkspaceHost } from '@/client/components/layout/new-workspace-host';
import { NEW_WORKSPACE_EVENT } from '@/shared/lib/workspace/new-workspace';

const nativeFetch = globalThis.fetch;
const mounted: HTMLElement[] = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  // The dialog lists a directory on mount; the listing is not what this test
  // is about, so it answers with an empty one.
  globalThis.fetch = (async () => new Response(JSON.stringify({
    path: '/tmp',
    parentPath: '/',
    directories: [],
  }), { headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
});

afterEach(() => {
  for (const host of mounted.splice(0)) {
    render(null, host);
    host.remove();
  }
});

afterAll(() => {
  globalThis.fetch = nativeFetch;
  restoreDomGlobals();
});

async function mount(node: h.JSX.Element): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(node, host);
  });
  mounted.push(host);
  return host;
}

describe('NewWorkspaceHost', () => {
  test('the dialog is closed until the picker asks for it', async () => {
    const host = await mount(h(NewWorkspaceHost, {}));
    expect(host.textContent).not.toContain('New Workspace');

    await act(async () => {
      window.dispatchEvent(new CustomEvent(NEW_WORKSPACE_EVENT));
    });
    expect(host.textContent).toContain('New Workspace');
    expect(host.textContent).toContain('Create Workspace');
  });

  test('Cancel closes the dialog', async () => {
    const host = await mount(h(NewWorkspaceHost, {}));
    await act(async () => {
      window.dispatchEvent(new CustomEvent(NEW_WORKSPACE_EVENT));
    });

    const cancel = [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Cancel') as HTMLButtonElement | undefined;
    expect(cancel).toBeDefined();
    await act(async () => {
      cancel?.click();
    });
    expect(host.textContent).not.toContain('Create Workspace');
  });
});
