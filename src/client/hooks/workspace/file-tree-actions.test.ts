/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `useFileActions` — the Files panel's server contract.
 *
 * Three rules are asserted here because each was a bug: a create that SUCCEEDS
 * opens the new file (the dialog used to close and leave the user hunting for
 * an empty row), a create that is REFUSED keeps the dialog open with the reason
 * beside the field (rather than closing as if it had worked), and a settled
 * response is acted on exactly ONCE — an unguarded effect re-ran on every render
 * and pinned the tab the moment a file was created.
 *
 * The clipboard half lives in `file-tree-actions-clipboard.test.ts`; both files
 * mount through `file-actions.test-util.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { createFileActionsHarness, useFileActionsHarness } from '@/test-support/file-actions.test-util';

const harness = createFileActionsHarness();
useFileActionsHarness(harness);

describe('useFileActions create', () => {
  test('a created file opens in the editor and refreshes the tree', async () => {
    const srv = harness.server({ success: true, path: 'src/new-file.ts' });
    harness.stubFetch(srv);
    await harness.mount({ path: 'src', name: 'src' });
    await harness.createNamed('new-file.ts');

    expect(srv.requests[0]).toEqual({ actionType: 'create', path: 'src', name: 'new-file.ts', root: '/root' });
    expect(harness.opened).toEqual([{ path: 'src/new-file.ts', name: 'new-file.ts' }]);
    expect(harness.refreshes()).toBe(1);
    expect(harness.actions()?.showCreateModal).toBe(false);
  });

  test('a refusal keeps the dialog open and reports the server’s reason', async () => {
    harness.stubFetch(harness.server({ error: 'new-file.ts already exists' }));
    await harness.mount({ path: 'src', name: 'src' });
    await harness.createNamed('new-file.ts');

    expect(harness.actions()?.showCreateModal).toBe(true);
    expect(harness.actions()?.createError).toBe('new-file.ts already exists');
    expect(harness.opened).toEqual([]);
    expect(harness.refreshes()).toBe(0);
  });

  test('a refusal with no message still says something', async () => {
    harness.stubFetch(harness.server({}));
    await harness.mount({ path: 'src', name: 'src' });
    await harness.createNamed('new-file.ts');

    expect(harness.actions()?.createError).toBe('Could not create the file');
  });

  test('a settled response is acted on once, however many times the row re-renders', async () => {
    // The unguarded version re-ran this effect on every render and re-opened
    // the file forever, which pinned the tab.
    const srv = harness.server({ success: true, path: 'src/once.ts' });
    harness.stubFetch(srv);
    await harness.mount({ path: 'src', name: 'src' });
    await harness.createNamed('once.ts');

    for (let i = 0; i < 3; i++) {
      await harness.step(() => harness.actions()?.setCreateName(''));
    }
    await harness.settle();

    expect(harness.refreshes()).toBe(1);
    expect(harness.opened.length).toBe(1);
  });

  test('an empty name never reaches the server', async () => {
    const srv = harness.server({ success: true, path: 'src/x.ts' });
    harness.stubFetch(srv);
    await harness.mount({ path: 'src', name: 'src' });

    await harness.step(() => harness.actions()?.setCreateName('   '));
    await harness.step(() => harness.actions()?.submitCreate({ preventDefault() {} } as never));
    await harness.settle();

    expect(srv.requests).toEqual([]);
    expect(harness.actions()?.showCreateModal).toBe(false);
  });
});

describe('useFileActions context menu', () => {
  test('opening the create dialog resets the previous attempt', async () => {
    harness.stubFetch(harness.server({ error: 'taken' }));
    await harness.mount({ path: 'src', name: 'src' });
    await harness.createNamed('taken.ts');
    expect(harness.actions()?.createError).toBe('taken');

    await harness.openCreateDialog();

    expect(harness.actions()?.showCreateModal).toBe(true);
    expect(harness.actions()?.createError).toBeNull();
    expect(harness.actions()?.createName).toBe('');
  });

  test('copying the path reports the ABSOLUTE path, and does not call the server', async () => {
    const srv = harness.server({});
    harness.stubFetch(srv);
    const writes: string[] = [];
    // `copyToClipboard` prefers the async clipboard API, and only when the page
    // is a secure context — the legacy textarea path needs `execCommand`, which
    // happy-dom does not implement.
    Object.defineProperty(globalThis.window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          writes.push(text);
        },
      },
      configurable: true,
    });
    await harness.mount({ path: 'src/deep/file.ts', name: 'file.ts' });

    await harness.step(() => harness.actions()?.handleAction('copy_path'));
    await harness.settle();

    expect(writes).toEqual(['/root/src/deep/file.ts']);
    expect(srv.requests).toEqual([]);
  });

  test('a folder gets the create action; a file does not offer it', async () => {
    harness.stubFetch(harness.server({}));
    await harness.mount({ path: 'src', name: 'src' });

    await harness.step(() => harness.actions()?.handleAction('new_file'));
    expect(harness.actions()?.showCreateModal).toBe(true);

    await harness.step(() => harness.actions()?.closeCreate());
    expect(harness.actions()?.showCreateModal).toBe(false);
  });
});

describe('useFileActions rename and delete', () => {
  test('rename sends the new path and closes on success', async () => {
    const srv = harness.server({ success: true });
    harness.stubFetch(srv);
    await harness.mount({ path: 'src/old.ts', name: 'old.ts' });

    await harness.step(() => harness.actions()?.handleAction('rename'));
    await harness.step(() => harness.actions()?.setRenameValue('src/new.ts'));
    await harness.step(() => harness.actions()?.submitRename({ preventDefault() {} } as never));
    await harness.settle();

    expect(srv.requests[0]).toEqual({ actionType: 'rename', path: 'src/old.ts', newPath: 'src/new.ts', root: '/root' });
    expect(harness.actions()?.showRenameModal).toBe(false);
    expect(harness.refreshes()).toBe(1);
  });

  test('delete posts the delete action for the row’s own path', async () => {
    const srv = harness.server({ success: true });
    harness.stubFetch(srv);
    await harness.mount({ path: 'src/gone.ts', name: 'gone.ts' });

    await harness.step(() => harness.actions()?.submitDelete());
    await harness.settle();

    expect(srv.requests[0]).toEqual({ actionType: 'delete', path: 'src/gone.ts', root: '/root' });
    expect(harness.refreshes()).toBe(1);
  });

  test('a git-history response does not close the dialogs or refresh the tree', async () => {
    // `type` marks the history payload; treating it as a mutation would refresh
    // the tree under an open modal.
    const srv = harness.server({ success: true, type: 'history', data: [] });
    harness.stubFetch(srv);
    await harness.mount({ path: 'src/a.ts', name: 'a.ts' });

    await harness.step(() => harness.actions()?.handleAction('history'));
    await harness.settle();

    expect(harness.actions()?.showHistoryModal).toBe(true);
    expect(harness.refreshes()).toBe(0);
  });
});
