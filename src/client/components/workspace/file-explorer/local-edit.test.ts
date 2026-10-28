/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's local tree edits: a create and a rename land WITHOUT a
 * reload.
 *
 * Both used to answer a mutation by re-reading the root plus every open folder,
 * which is one request per open folder to learn something the response already
 * names — and it also collapsed nothing but cost a visible spinner. The two
 * specs here assert the two halves that matter: the row appears (or moves) in
 * the rendered tree, and NO `/api/fs/dir` read is issued for the root to make
 * that happen.
 *
 * A nested create is the third case, because it is the one a naive insert gets
 * wrong: the folders leading to the entry do not exist in the tree yet, and a
 * row placed under a folder nobody has opened is a row the user cannot see —
 * so the create also opens the chain it created.
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

/** The root's own reads, which a reload would add one of. */
function rootReads(): number {
  return panel.dirReads.filter((path) => path === '.').length;
}

describe('Files panel local edits', () => {
  test('a created file appears in the tree without re-reading the root', async () => {
    panel.disk = { '.': { 'existing.ts': 'file' } };
    panel.dirReads = [];
    await panel.mount();
    const before = rootReads();

    await panel.openRootNewFile();
    await panel.submitNewFile('fresh.ts');

    expect(panel.buttonLabels()).not.toContain('Create');
    expect(panel.visibleNames()).toContain('fresh.ts');
    // The create answered with the path, so the tree placed it: a reload here
    // would be a root read plus one per open folder.
    expect(rootReads()).toBe(before);
  });

  test('a created FOLDER appears and is not opened in an editor', async () => {
    panel.disk = { '.': {} };
    panel.dirReads = [];
    await panel.mount();
    const before = rootReads();

    await panel.openRootNewFolder();
    await panel.submitNewFile('packages');

    expect(panel.createRequests.at(-1)).toEqual({
      actionType: 'create',
      path: '.',
      name: 'packages',
      kind: 'folder',
      root: '/ws',
    });
    expect(panel.visibleNames()).toContain('packages');
    // A folder has nothing to open — opening one would be an empty editor tab.
    expect(panel.openedFiles).toEqual([]);
    expect(rootReads()).toBe(before);
  });

  test('a nested create opens the chain it created, so the row is visible', async () => {
    panel.disk = { '.': {} };
    panel.dirReads = [];
    await panel.mount();

    await panel.openRootNewFile();
    await panel.submitNewFile('lib/deep/parse.ts');

    // Every folder on the way is expanded and reads its own directory: the
    // entry is not somewhere the user has to go hunting for. `lib` and `deep`
    // are ONE row here — a folder holding only one folder collapses into a row
    // naming the chain — and that row is the one the create expands.
    expect(panel.visibleNames()).toContain('parse.ts');
    expect(panel.visibleNames()).toContain('lib/deep');
    // The reveal expands the row that is DRAWN, not the path's own segments:
    // `lib` and `deep` are not rows, so nothing asks the server about them.
    expect(panel.dirReads).not.toContain('lib');
    expect(panel.dirReads).not.toContain('lib/deep');
  });

  test('a rename moves the row in place without re-reading the root', async () => {
    panel.disk = { '.': { 'old.ts': 'file' } };
    panel.dirReads = [];
    await panel.mount();
    const before = rootReads();

    await panel.rightClickRow('old.ts');
    await panel.clickMenuRow('Rename');
    await panel.submitRename('new.ts');

    expect(panel.renameRequests.at(-1)).toEqual({
      actionType: 'rename',
      path: 'old.ts',
      newPath: 'new.ts',
      root: '/ws',
    });
    expect(panel.visibleNames()).toContain('new.ts');
    expect(panel.visibleNames()).not.toContain('old.ts');
    expect(rootReads()).toBe(before);
  });

  test('a refused rename keeps the dialog open with the server’s reason', async () => {
    panel.disk = { '.': { 'old.ts': 'file', 'taken.ts': 'file' } };
    panel.dirReads = [];
    await panel.mount();

    await panel.rightClickRow('old.ts');
    await panel.clickMenuRow('Rename');
    await panel.submitRename('taken.ts');

    // The field is still there: "already exists" is a message about what to
    // type next, not a notification about something that happened.
    expect(panel.renameInput()).not.toBeNull();
    expect(panel.documentText()).toContain('taken.ts already exists');
    expect(panel.visibleNames()).toContain('old.ts');
  });
});
