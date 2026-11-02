/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's drag-and-drop: a real drag gesture through the DOM.
 *
 * A drag is a MOVE, and the four rules below are each a shape a naive drop
 * target gets wrong:
 *
 * 1. **`dragover` decides, not `drop`.** `dataTransfer.getData()` returns an
 *    empty string until the drop, so a target cannot ask the event what is being
 *    dragged — the panel tracks the dragged row in state, and a target that
 *    cannot accept it does not call `preventDefault`, which is what stops the
 *    browser drawing a drop cursor over a drop it will refuse.
 *
 * 2. **A drop on a FILE lands in that file's directory**, the same rule a paste
 *    obeys. A drop on a FOLDER lands inside it.
 *
 * 3. **The background is the listing root's target** — the only way to move an
 *    entry back out of a folder.
 *
 * 4. **A refused drop posts nothing.** Dropping an entry into the folder it
 *    already lives in, or a folder into its own subtree, must not reach the
 *    server: a request would be a move the user did not ask for.
 *
 * 5. **The blue block belongs to the row under the POINTER, not to every legal
 *    target.** It was drawn from `acceptsDrop` — the capability — so a drag
 *    painted every folder and file on screen at once and read as "everything is
 *    selected" (measured: dragging `a.ts` over `b` and `c` highlighted both).
 *    The background's tint had the same bug, over the whole tree.
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

describe('Files panel drag and drop', () => {
  test('dragging a file onto a folder moves it there', async () => {
    panel.disk = { '.': { 'a.ts': 'file', dest: null }, dest: { 'keep.ts': 'file' } };
    await panel.mount();

    await panel.dragRow('a.ts', 'dest');

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

  test('dragging a folder onto the background moves it to the listing root', async () => {
    panel.disk = { '.': { src: null }, src: { deep: null, 'a.ts': 'file' }, 'src/deep': {} };
    await panel.mount();

    await panel.clickRow('src');
    await panel.dragRow('deep', null);

    expect(panel.transferRequests).toEqual([
      {
        actionType: 'paste',
        sourcePath: 'src/deep',
        mode: 'cut',
        targetPath: '.',
        targetKind: 'folder',
        root: '/ws',
      },
    ]);
  });

  test('a drop on a FILE lands in that file’s own directory', async () => {
    panel.disk = { '.': { dest: null, 'b.ts': 'file' }, dest: { 'a.ts': 'file', 'keep.ts': 'file' } };
    await panel.mount();

    // `a.ts` lives in `dest/`, so dropping it on `dest/b.ts` is a move within
    // that folder — the same directory, which the rule refuses. Drop it on the
    // ROOT's file instead: `b.ts` is at the root, so its directory is `.`.
    await panel.clickRow('dest');
    await panel.dragRow('a.ts', 'b.ts');

    expect(panel.transferRequests[0]).toEqual({
      actionType: 'paste',
      sourcePath: 'dest/a.ts',
      mode: 'cut',
      targetPath: 'b.ts',
      targetKind: 'file',
      root: '/ws',
    });
  });

  test('a drop into the folder the entry already lives in posts nothing', async () => {
    panel.disk = { '.': { src: null }, src: { 'a.ts': 'file' } };
    await panel.mount();

    await panel.clickRow('src');
    await panel.dragRow('a.ts', 'src');

    // A drag is a move, so this is a no-op — and a request here would be a move
    // the user never asked for.
    expect(panel.transferRequests).toEqual([]);
  });

  test('dropping a folder into its own subtree posts nothing', async () => {
    panel.disk = { '.': { src: null }, src: { deep: null, 'a.ts': 'file' }, 'src/deep': {} };
    await panel.mount();

    await panel.clickRow('src');
    await panel.dragRow('src', 'deep');

    expect(panel.transferRequests).toEqual([]);
  });

  test('a drop on the background at the root posts nothing for a top-level entry', async () => {
    panel.disk = { '.': { 'a.ts': 'file' } };
    await panel.mount();

    await panel.dragRow('a.ts', null);

    // `a.ts` already lives at the root: the background is its own directory.
    expect(panel.transferRequests).toEqual([]);
  });

  test('the tree re-reads after a drop lands', async () => {
    panel.disk = { '.': { 'a.ts': 'file', dest: null }, dest: {} };
    panel.dirReads = [];
    await panel.mount();

    await panel.dragRow('a.ts', 'dest');

    expect(panel.dirReads).toContain('.');
  });

  test('only the row under the pointer is highlighted during a drag', async () => {
    panel.disk = { '.': { 'a.ts': 'file', first: null, second: null }, first: { 'x.ts': 'file' }, second: { 'y.ts': 'file' } };
    await panel.mount();

    await panel.hoverRow('a.ts', 'first');

    // `second` would accept the drop just as well, and used to be painted.
    const highlighted = [...panel.container.querySelectorAll('[class*="bg-info"]')]
      .map((el) => el.textContent?.trim() ?? '');
    expect(highlighted).toEqual(['first']);
  });

  test('the highlight leaves the row when the pointer does, and the drop still lands', async () => {
    // `a.ts` lives INSIDE `dest`, so dropping it on the background is a real
    // move to the root rather than the no-op the rule refuses.
    panel.disk = { '.': { dest: null, other: null }, dest: { 'a.ts': 'file' }, other: {} };
    await panel.mount();
    await panel.clickRow('dest');

    await panel.hoverRow('a.ts', 'other');
    expect(panel.container.querySelectorAll('[class*="bg-info"]')).toHaveLength(1);

    // Leaving the row for the background: the row's block goes out and the
    // drop lands at the root, which is where the pointer is.
    await panel.dropOnBackground();
    expect(panel.transferRequests[0]?.targetPath).toBe('.');
  });

  test('the background is not tinted for the whole gesture', async () => {
    panel.disk = { '.': { 'a.ts': 'file', dest: null }, dest: {} };
    await panel.mount();

    // The drag is in flight and no row is hovered: nothing to promise yet.
    await panel.startDrag('a.ts');
    expect(panel.container.querySelectorAll('[class*="bg-info"]')).toHaveLength(0);
  });
});
