/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's ROOT context menu: the one a right-click on the panel's own
 * background opens.
 *
 * Two rules are load-bearing. A create from the background lands at the TOP of
 * the tree (`path: '.'`) rather than inside whatever folder was last clicked,
 * and the root's menu is a DIFFERENT menu from a row's — a row's actions name a
 * FILE (Rename, Delete, Copy Path), none of which the root is.
 *
 * Driven through the same harness the listing specs use, so both files exercise
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

describe('Files panel root context menu', () => {
  test('right-clicking the background creates a file at the ROOT and opens it', async () => {
    panel.disk = { '.': { 'existing.ts': 'file' } };
    panel.dirReads = [];
    await panel.mount();

    await panel.openRootNewFile();
    await panel.submitNewFile('fresh.ts');

    // `.` is the listed root: the background names no folder, so the create has
    // to land at the top of the tree rather than inside whatever was last
    // clicked.
    expect(panel.createRequests).toEqual([
      { actionType: 'create', path: '.', name: 'fresh.ts', root: '/ws' },
    ]);
    expect(panel.openedFiles).toEqual([{ path: 'fresh.ts', name: 'fresh.ts' }]);
  });

  test('the root menu is a DIFFERENT menu — it offers no rename or delete', async () => {
    panel.disk = { '.': { 'a.ts': 'file' } };
    await panel.mount();

    await panel.openMenuOnBackground();

    const labels = panel.buttonLabels();
    expect(labels).toContain('New File');
    // The root is not a file: Rename/Delete/Copy Path would name the wrong
    // target, which is why the row menu is not reused here.
    expect(labels).not.toContain('Rename');
    expect(labels).not.toContain('Delete');
  });

  test('a row’s right-click opens the ROW menu, never the root one', async () => {
    panel.disk = { '.': { 'a.ts': 'file' } };
    await panel.mount();

    await panel.rightClickRow('a.ts');

    const labels = panel.buttonLabels();
    expect(labels).toContain('Rename');
    // The row's menu carries the file actions and no root-only create.
    expect(labels).not.toContain('New File');
  });
});
