/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `useFileTabs` — how an "open this file" request resolves to a TAB.
 *
 * The bug this pins: the same path can reach the editor under two different
 * ids, because the explorer passes a row's own `id` (its relative path) while a
 * search row or a chat link computes `fileTabId(path)`. `handleOpenFile` used
 * to activate the id it had COMPUTED even when the updater had just matched an
 * existing tab under another id, so the editor found no active file and drew
 * "Select a tab to view content" over the file that was already open — while
 * the tab strip still showed it selected-by-nothing.
 *
 * Mounted through the REAL session-state provider, because the store is what
 * the request is resolved against; a local stub would not exercise the
 * read-back the fix depends on.
 *
 * The Preact modules are imported DYNAMICALLY after the happy-dom globals are
 * installed: Preact binds its environment at evaluation time, so a static import
 * would capture Node's globals and render nothing.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { ComponentChildren } from 'preact';
import type { ComponentType } from 'preact/compat';
import type { act as PreactAct } from 'preact/test-utils';
import type { useFileTabs as UseFileTabsHook } from '@/client/hooks/workspace/file-tabs';
import type { OpenFileInput } from '@/client/hooks/workspace/file-tabs';
import type { OpenedFile } from '@/shared/types/fs';
import { fileTabId } from '@/shared/lib/workspace/file-tab-id';
import { forgetSession } from '@/shared/lib/workspace/session-state/store';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let useFileTabs: typeof UseFileTabsHook;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

const ROOT = '/ws';
const SESSION = 'new-file-tabs';
const nativeFetch = Bun.fetch;

let container: HTMLElement;
/** The provider component, kept so a case can re-render with a different root. */
let SessionStateProvider: ComponentType<{ sessionId: string; children: ComponentChildren }>;
let handleOpenFile: ((file: OpenFileInput) => void) | null = null;
/** The mounted probe, so a re-render can hand it another root. */
let Probe: ComponentType<{ rootPath: string | null }>;
let openedFiles: OpenedFile[] = [];
let activeFileId: number | string | null = null;

async function settle() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    });
  }
}

/** Re-render the mounted tree with a different workspace root. */
async function setRoot(rootPath: string | null): Promise<void> {
  await act(async () => {
    render(
      h(SessionStateProvider, { sessionId: SESSION, children: h(Probe, { rootPath }) }),
      container,
    );
  });
  await settle();
}

/** Mount the hook inside the provider, with `stored` as the session's blob. */
async function mount(stored: Record<string, unknown> = {}, root: string | null = ROOT) {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ sessionId: SESSION, state: stored }),
    text: async () => JSON.stringify({ sessionId: SESSION, state: stored }),
  })) as unknown as typeof fetch;
  const provider = await import('@/client/components/common/session-state-provider/index');
  SessionStateProvider = provider.SessionStateProvider as typeof SessionStateProvider;
  Probe = ({ rootPath }: { rootPath: string | null }) => {
    const tabs = useFileTabs(rootPath, SESSION);
    handleOpenFile = tabs.handleOpenFile;
    openedFiles = tabs.openedFiles;
    activeFileId = tabs.activeFileId;
    return null;
  };
  await act(async () => {
    render(h(SessionStateProvider, { sessionId: SESSION, children: h(Probe, { rootPath: root }) }), container);
  });
  await settle();
}

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  ({ useFileTabs } = await import('@/client/hooks/workspace/file-tabs'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  globalThis.fetch = nativeFetch;
  restoreDomGlobals();
});

beforeEach(() => {
  handleOpenFile = null;
  openedFiles = [];
  activeFileId = null;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ state: {} }),
    text: async () => JSON.stringify({ state: {} }),
  })) as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  forgetSession(SESSION);
});

/** What the explorer sends: the row's own id, which is its relative path. */
function explorerPayload(path: string): OpenFileInput {
  return { id: path, name: path.split('/').pop() ?? path, path, root: ROOT, repo: '.' };
}

/** What a search row sends: no id, so the hook computes `fileTabId(path)`. */
function searchPayload(path: string): OpenFileInput {
  return { name: path.split('/').pop() ?? path, path, root: ROOT, repo: '.' };
}

describe('useFileTabs open resolution', () => {
  test('opening a file the explorer already has open keeps ITS id active', async () => {
    await mount({ 'layout.openedFiles': [explorerPayload('notes.md')], 'layout.activeFileId': 'notes.md' });

    await act(async () => {
      handleOpenFile?.(searchPayload('notes.md'));
    });
    await settle();

    // The id the search row computed names no tab; activating it is what blanked
    // the editor. The existing tab's own id must stay the active one.
    expect(activeFileId).toBe('notes.md');
    expect(activeFileId).not.toBe(fileTabId('notes.md'));
    expect(openedFiles).toHaveLength(1);
  });

  test('a file opened from the search panel alone gets the computed id', async () => {
    await mount();

    await act(async () => {
      handleOpenFile?.(searchPayload('src/a.ts'));
    });
    await settle();

    expect(openedFiles).toHaveLength(1);
    expect(openedFiles[0]?.id).toBe(fileTabId('src/a.ts'));
    expect(activeFileId).toBe(fileTabId('src/a.ts'));
  });

  /**
   * A root that is not known yet must not close the tabs.
   *
   * `activeProjectPath` is derived from the sidebar's folder list, which is empty
   * for a beat on every load and again whenever the structure topic
   * re-subscribes. Treating that `null` as a root CHANGE wiped the file the user
   * had just clicked, and the editor drew "Select a file to open" over it — the
   * rare e2e failure this pins.
   */
  test('a transiently unknown root does not wipe the open tabs', async () => {
    await mount();
    await act(async () => {
      handleOpenFile?.(explorerPayload('src/a.ts'));
    });
    await settle();
    expect(openedFiles).toHaveLength(1);

    // The folder list drops out and comes back — the same workspace.
    await setRoot(null);
    await setRoot(ROOT);

    expect(openedFiles).toHaveLength(1);
    expect(activeFileId).toBe('src/a.ts');
  });

  test('a DIFFERENT root closes the previous workspace’s tabs', async () => {
    await mount();
    await act(async () => {
      handleOpenFile?.(explorerPayload('src/a.ts'));
    });
    await settle();
    expect(openedFiles).toHaveLength(1);

    await setRoot('/other');

    expect(openedFiles).toHaveLength(0);
    expect(activeFileId).toBeNull();
  });

  test('reopening under the computed id activates the tab rather than adding one', async () => {
    await mount();

    await act(async () => {
      handleOpenFile?.(searchPayload('src/a.ts'));
    });
    await settle();
    await act(async () => {
      handleOpenFile?.(explorerPayload('src/a.ts'));
    });
    await settle();

    expect(openedFiles).toHaveLength(1);
    expect(activeFileId).toBe(fileTabId('src/a.ts'));
  });
});
