/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A collapsed folder chain is ONE row standing for several directories, and
 * that is where both reported bugs came from.
 *
 * `dev/src/main/code` is drawn as a single row whose `path` is the DEEPEST
 * directory, so the levels inside its label are not rows at all:
 *
 * - **A drop** on the row landed in `code`, because that was the only path the
 *   row could name — dragging something onto `main` was impossible.
 * - **A rename** could only address `code`, so typing `dev2/src/main` moved it
 *   out and left `dev/src/main` behind, and renaming `main` was unexpressible.
 *
 * The fix is one mechanism on both paths: the chain is UNFOLDED into a row per
 * directory — on a hovering drag, or from the row's menu — after which every
 * level is an ordinary folder that can be dropped on, renamed and created
 * inside. These specs assert the two reported cases through a real DOM, plus
 * the two halves that keep the unfold honest: Fold puts the chain back, and a
 * rename that PRESERVES the chain keeps it unfolded.
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

/** `dev/src/main/code/a.ts`: four directories, three of them folded away. */
const CHAIN = {
  '.': { dev: null },
  dev: { src: null },
  'dev/src': { main: null },
  'dev/src/main': { code: null },
  'dev/src/main/code': { 'a.ts': 'file' },
} as const;

describe('Files panel collapsed chains', () => {
  test('dragging onto a level inside the chain drops there, not in the deepest folder', async () => {
    panel.disk = { ...structuredClone(CHAIN), '.': { dev: null, 'moved.ts': 'file' } } as never;
    await panel.mount();
    // One row, naming the whole chain — the levels are not rows yet.
    expect(panel.visibleNames()).toContain('dev/src/main/code');

    // Hovering the row unfolds it, which is what puts `main` on screen; the
    // drop then lands on the row that names it.
    await panel.hoverRow('moved.ts', 'dev/src/main/code');
    expect(panel.visibleNames()).toContain('main');

    await panel.dragRow('moved.ts', 'main');

    expect(panel.transferRequests).toEqual([
      {
        actionType: 'paste',
        sourcePath: 'moved.ts',
        mode: 'cut',
        targetPath: 'dev/src/main',
        targetKind: 'folder',
        root: '/ws',
      },
    ]);
  });

  test('the row menu unfolds the chain, so every level becomes a row', async () => {
    panel.disk = structuredClone(CHAIN) as never;
    await panel.mount();

    await panel.rightClickRow('dev/src/main/code');
    expect(panel.buttonLabels()).toContain('Unfold Folders');
    await panel.clickMenuRow('Unfold Folders');

    // Outermost first: each level is its own row, and the levels above the
    // deepest are drawn open (a hidden row would hide the level below it).
    const names = panel.visibleNames();
    for (const name of ['dev', 'src', 'main', 'code']) expect(names).toContain(name);
    expect(names).not.toContain('dev/src/main/code');
  });

  test('renaming a folder inside the chain renames THAT folder', async () => {
    panel.disk = structuredClone(CHAIN) as never;
    await panel.mount();

    await panel.rightClickRow('dev/src/main/code');
    await panel.clickMenuRow('Unfold Folders');

    await panel.rightClickRow('main');
    await panel.clickMenuRow('Rename');
    // The field names the row's own path, which is what makes `dev2/src/main`
    // mean "move `main`" rather than "move the deepest directory".
    expect(panel.renameInput()?.value).toBe('dev/src/main');
    await panel.submitRename('dev2/src/main');

    expect(panel.renameRequests.at(-1)).toEqual({
      actionType: 'rename',
      path: 'dev/src/main',
      newPath: 'dev2/src/main',
      root: '/ws',
    });
    // `main` moved with everything under it; `dev` and `dev2` are now separate
    // trees, which is what the paths say.
    expect(panel.disk['dev2/src']).toEqual({ main: null });
    expect(panel.disk['dev2/src/main']).toEqual({ code: null });
    expect(panel.disk['dev2/src/main/code']).toEqual({ 'a.ts': 'file' });
  });

  test('renaming the chain’s start keeps it unfolded, at its new paths', async () => {
    panel.disk = structuredClone(CHAIN) as never;
    await panel.mount();

    await panel.rightClickRow('dev/src/main/code');
    await panel.clickMenuRow('Unfold Folders');
    await panel.rightClickRow('dev');
    await panel.clickMenuRow('Rename');
    await panel.submitRename('dev2');

    const names = panel.visibleNames();
    expect(names).toContain('dev2');
    expect(names).toContain('src');
    expect(names).toContain('main');
    expect(names).toContain('code');
    expect(names).not.toContain('dev');
  });

  test('Fold Folders puts the chain back into the one row it is listed as', async () => {
    panel.disk = structuredClone(CHAIN) as never;
    await panel.mount();

    await panel.rightClickRow('dev/src/main/code');
    await panel.clickMenuRow('Unfold Folders');
    await panel.rightClickRow('dev');
    expect(panel.buttonLabels()).toContain('Fold Folders');
    await panel.clickMenuRow('Fold Folders');

    expect(panel.visibleNames()).toContain('dev/src/main/code');
    expect(panel.visibleNames()).not.toContain('main');
  });

  test('the rename dialog says which of the two it renames', async () => {
    panel.disk = structuredClone(CHAIN) as never;
    await panel.mount();

    await panel.rightClickRow('dev/src/main/code');
    await panel.clickMenuRow('Rename');

    // The row reads as four directories while the rename moves one, and only
    // the dialog can say so — otherwise a path typed from the label leaves the
    // rest of the chain behind.
    const text = panel.documentText();
    expect(text).toContain('this renames');
    expect(text).toContain('dev/src/main/code');
    expect(text).toContain('Unfold Folders');
  });
});
