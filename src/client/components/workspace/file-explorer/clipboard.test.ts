/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's clipboard, driven through the panel itself: a right-click
 * on a row, the menu's Cut/Copy/Duplicate/Paste rows, and the request that
 * reaches `/api/fs/action`.
 *
 * Three rules are asserted, and each is a shape a naive menu gets wrong:
 *
 * 1. **Paste names the entry it will paste.** `Paste a.ts` is the only place the
 *    clipboard's content is visible — there is no second window the user can
 *    look at — and it is what proves Cut actually filled the clipboard.
 *
 * 2. **Paste is absent where it cannot land.** A folder inside the copied
 *    folder's own subtree, and an entry from another workspace, both leave the
 *    row out. A row that is always there and always refuses reads as broken.
 *
 * 3. **A paste sends the clipboard's path, not the row's.** The row that was
 *    right-clicked is the DESTINATION; the source travels with the clipboard.
 *    Sending the row's own path would move a file onto itself.
 *
 * Driven through the shared harness, so this file and the listing specs exercise
 * one mount and one HTTP stub.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createFileExplorerHarness } from '@/test-support/file-explorer.test-util';

const panel = createFileExplorerHarness();

beforeAll(() => {
  panel.install();
});

afterEach(() => {
  panel.unmount();
});

afterAll(() => {
  panel.restore();
});

describe('Files panel clipboard', () => {
  test('Cut then Paste moves the entry into the folder that was right-clicked', async () => {
    panel.disk = { '.': { 'a.ts': 'file', dest: null }, dest: { 'keep.ts': 'file' } };
    await panel.mount();

    await panel.rightClickRow('a.ts');
    await panel.clickMenuRow('Cut');

    // The clipboard now names the entry: the row's own label is the proof, and
    // it is the only place the panel shows what is on it.
    await panel.rightClickRow('dest');
    expect(panel.buttonLabels()).toContain('Paste a.ts');
    await panel.clickMenuRow('Paste a.ts');

    expect(panel.transferRequests).toEqual([
      {
        actionType: 'paste',
        sourcePath: 'a.ts',
        mode: 'cut',
        targetPath: 'dest',
        targetKind: 'folder',
        root: '/ws',
      },
    ]);
  });

  test('Copy leaves the clipboard in place, so one entry pastes twice', async () => {
    panel.disk = { '.': { 'a.ts': 'file', one: null, two: null }, one: {}, two: {} };
    await panel.mount();

    await panel.rightClickRow('a.ts');
    await panel.clickMenuRow('Copy');
    await panel.rightClickRow('one');
    await panel.clickMenuRow('Paste a.ts');
    await panel.rightClickRow('two');
    // Still there after the first paste — that is what a copy is for.
    expect(panel.buttonLabels()).toContain('Paste a.ts');
    await panel.clickMenuRow('Paste a.ts');

    expect(panel.transferRequests.map((request) => request.mode)).toEqual(['copy', 'copy']);
    expect(panel.transferRequests.map((request) => request.targetPath)).toEqual(['one', 'two']);
  });

  test('Duplicate posts the row’s own path and refreshes the tree', async () => {
    panel.disk = { '.': { 'a.ts': 'file' } };
    panel.dirReads = [];
    await panel.mount();

    await panel.rightClickRow('a.ts');
    await panel.clickMenuRow('Duplicate');

    expect(panel.transferRequests).toEqual([{ actionType: 'duplicate', path: 'a.ts', root: '/ws' }]);
    // The tree re-reads, so the new `a copy.ts` appears without a manual refresh.
    expect(panel.dirReads).toContain('.');
  });

  test('a paste onto a FILE lands in that file’s own directory', async () => {
    panel.disk = { '.': { 'a.ts': 'file', 'b.ts': 'file' } };
    await panel.mount();

    await panel.rightClickRow('a.ts');
    await panel.clickMenuRow('Copy');
    await panel.rightClickRow('b.ts');
    await panel.clickMenuRow('Paste a.ts');

    expect(panel.transferRequests[0]).toEqual({
      actionType: 'paste',
      sourcePath: 'a.ts',
      mode: 'copy',
      targetPath: 'b.ts',
      targetKind: 'file',
      root: '/ws',
    });
  });

  test('the row menu offers no Paste until something is on the clipboard', async () => {
    panel.disk = { '.': { 'a.ts': 'file', dest: null }, dest: {} };
    await panel.mount();

    await panel.rightClickRow('dest');
    const labels = panel.buttonLabels();
    expect(labels).toContain('Cut');
    expect(labels).toContain('Copy');
    expect(labels).toContain('Duplicate');
    // Nothing copied yet: the row is absent rather than present-and-refusing.
    expect(labels.some((label) => label.startsWith('Paste'))).toBe(false);
  });

  test('the row menu hides Paste on a folder inside the copied folder’s own subtree', async () => {
    // `src` holds a folder AND a file, so it is its own row — a folder holding
    // only one folder would be collapsed into one row naming the chain.
    panel.disk = { '.': { src: null }, src: { deep: null, 'a.ts': 'file' }, 'src/deep': {} };
    await panel.mount();

    await panel.rightClickRow('src');
    await panel.clickMenuRow('Copy');

    // Expanding the copied folder and right-clicking its child: a paste there
    // would make the destination a child of the thing being moved.
    await panel.clickRow('src');
    await panel.rightClickRow('deep');
    const labels = panel.buttonLabels();
    expect(labels).toContain('Cut');
    expect(labels.some((label) => label.startsWith('Paste'))).toBe(false);
  });

  test('the background menu pastes into the listing root', async () => {
    panel.disk = { '.': { dest: null }, dest: { 'a.ts': 'file' } };
    await panel.mount();

    await panel.clickRow('dest');
    await panel.rightClickRow('a.ts');
    await panel.clickMenuRow('Cut');

    await panel.openMenuOnBackground();
    expect(panel.buttonLabels()).toContain('Paste a.ts');
    await panel.clickMenuRow('Paste a.ts');

    expect(panel.transferRequests[0]).toEqual({
      actionType: 'paste',
      sourcePath: 'dest/a.ts',
      mode: 'cut',
      targetPath: '.',
      targetKind: 'folder',
      root: '/ws',
    });
  });
});
