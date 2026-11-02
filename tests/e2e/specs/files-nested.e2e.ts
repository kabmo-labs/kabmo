/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's create and rename, in a real browser against a real disk.
 *
 * Three behaviours live here because none of them is visible to a unit test:
 *
 * 1. **A nested name creates the chain.** `lib/deep/parse.ts` typed into the
 *    New File dialog produces every directory on the way, and the row is
 *    VISIBLE — the folders are expanded, so it is not somewhere to go hunting.
 * 2. **A rename moves the row in place.** The path field takes a whole relative
 *    path, so `a.ts` → `nested/a.ts` renames AND relocates.
 * 3. **Neither reloads the panel.** The response names the result, so the tree
 *    is patched locally — asserted by counting `/api/fs/dir` requests, because
 *    a spinner that came and went is not something a test can see.
 * 4. **A collapsed chain can be OPENED.** One row stands for several
 *    directories, so the levels inside its label are not drop targets and not
 *    rename targets until `Unfold Folders` turns them into rows. Both reported
 *    bugs live in that gap: a drop meant for `main` landed in `code`, and a
 *    rename of `main` was unexpressible. The last two specs here pin the fix
 *    against a real DOM and a real disk.
 *
 * The disk is the assertion wherever it can be: a row on screen that the
 * filesystem does not have would pass a DOM-only check.
 */

import type { Locator, Page } from '@playwright/test';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Count `/api/fs/dir` reads for the whole page, so a reload is measurable. */
async function countDirReads(page: Page): Promise<() => number> {
  let count = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/fs/dir')) count += 1;
  });
  return () => count;
}

/**
 * The Files view, scoped to the right column.
 *
 * Scoping is load-bearing twice over: the chat timeline is ALSO a
 * `scrollbar-overlay-container`, so an unscoped locator right-clicks the
 * transcript; and the activity bar's chip is a TOGGLE, so clicking it while
 * Files is already the view collapses the column the spec is about to use.
 */
function filesPanel(page: Page) {
  const panel = page.locator('[data-panel-id="right-panel"]');
  return {
    panel,
    search: panel.getByPlaceholder('Search files...'),
    row: (name: string) => panel.getByText(name, { exact: true }),
    // The desktop stack keeps EVERY view mounted and hides the inactive ones
    // with CSS, so an unscoped scroll-container locator also matches the
    // Source Control view's list. `:visible` is what says "the tree on screen".
    tree: panel.locator('.scrollbar-overlay-container:visible'),
  };
}

/**
 * Wait until an element has stopped moving.
 *
 * The right column ANIMATES its width when it mounts and when a view is
 * selected (`Panel`'s 200ms transition), and Playwright refuses to click an
 * element whose box is still changing — measured as a first-attempt timeout on
 * every spec here, with the same click passing on retry. Two identical
 * bounding boxes across a frame is the condition the click needs, so that is
 * what is waited on rather than a duration.
 */
async function waitForStable(locator: Locator): Promise<void> {
  let previous = '';
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      // A collapsed panel is a ZERO-width box, and a zero-width box is
      // perfectly stable — so "has not moved" must also mean "has a size".
      const current = box && box.width > 0 ? `${Math.round(box.x)}:${Math.round(box.width)}` : '';
      const settled = current !== '' && current === previous;
      previous = current;
      return settled;
    }, { timeout: 5_000 })
    .toBe(true);
}

/** Make sure the Files view is the one on screen, open, and stopped moving. */
async function openFiles(page: Page): Promise<void> {
  const view = filesPanel(page);
  const chip = page.getByRole('button', { name: 'Files' });
  if (!(await view.search.isVisible())) await chip.click();
  await expect(view.search).toBeVisible();
  // The chip is a TOGGLE, and a view restored from the session blob can be
  // selected while the column itself is collapsed — the search field is then
  // still "visible" (it is laid out, just zero-wide). One more click opens it.
  await waitForStable(view.panel).catch(() => undefined);
  if ((await view.panel.boundingBox())?.width === 0) {
    await chip.click();
    await waitForStable(view.panel);
  }
}

test.describe('files panel create and rename', () => {
  test('a nested New File creates the folders it needs and shows the row', async ({ harness, page }) => {
    // `real`, not `mock`: a mock server answers the sidebar with its demo
    // presets, so `?folderId=` never resolves to the seeded folder and the
    // Files panel browses the bundled examples tree instead.
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-nested-create');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFiles(page);
    const view = filesPanel(page);
    const dirReads = await countDirReads(page);

    // The background's own menu: a create from it lands at the top of the tree.
    // The click targets the tree's lower area — its top-left corner sits under
    // the activity bar, which would take the press instead.
    const tree = await view.tree.boundingBox();
    await view.tree.click({
      button: 'right',
      position: { x: 20, y: Math.max(20, (tree?.height ?? 200) - 24) },
    });
    await page.getByRole('button', { name: 'New File', exact: true }).click();
    await page.getByLabel('New file name').fill('lib/deep/parse.ts');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // The chain is on disk, and every folder of it is expanded so the leaf is
    // on screen rather than behind two collapsed rows.
    await expect(view.row('parse.ts')).toBeVisible();
    expect(existsSync(join(workspace.path, 'lib/deep/parse.ts'))).toBe(true);

    // The response named the entry, so the tree placed it: the create did not
    // re-read the root (nor any folder) to discover what it already knew.
    expect(dirReads()).toBeLessThanOrEqual(2);

    workspace.dispose();
  });

  test('New Folder creates a nested directory, not an empty file', async ({ harness, page }) => {
    // `real`, not `mock`: a mock server answers the sidebar with its demo
    // presets, so `?folderId=` never resolves to the seeded folder and the
    // Files panel browses the bundled examples tree instead.
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-new-folder');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFiles(page);
    const view = filesPanel(page);

    // New Folder is offered on a FOLDER row: a file has no folder to create
    // into, and its own directory is the one its row already sits in.
    await view.row('src').click({ button: 'right' });
    await page.getByRole('button', { name: 'New Folder', exact: true }).click();
    await page.getByLabel('New folder name').fill('nested/api');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // The row is on screen — the chain was expanded — and the disk holds a
    // DIRECTORY, not a file named `api`. `src` now holds nothing but `nested`,
    // which holds nothing but `api`, so all three are ONE row naming the whole
    // chain from the listing root.
    await expect(view.row('src/nested/api')).toBeVisible();
    expect(readdirSync(join(workspace.path, 'src/nested'))).toEqual(['api']);
    expect(statSync(join(workspace.path, 'src/nested/api')).isDirectory()).toBe(true);

    workspace.dispose();
  });

  test('a rename takes a nested path and moves the row without re-reading', async ({ harness, page }) => {
    // `real`, not `mock`: a mock server answers the sidebar with its demo
    // presets, so `?folderId=` never resolves to the seeded folder and the
    // Files panel browses the bundled examples tree instead.
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-nested-rename');
    writeFileSync(join(workspace.path, 'old.ts'), 'export const x = 1;\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFiles(page);
    const view = filesPanel(page);
    await expect(view.row('old.ts')).toBeVisible();
    const dirReads = await countDirReads(page);

    await view.row('old.ts').click({ button: 'right' });
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByLabel('Rename file path').fill('nested/renamed.ts');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();

    await expect(view.row('renamed.ts')).toBeVisible();
    expect(existsSync(join(workspace.path, 'nested/renamed.ts'))).toBe(true);
    expect(existsSync(join(workspace.path, 'old.ts'))).toBe(false);
    // The rename answered with both ends, so the tree moved the row itself.
    expect(dirReads()).toBeLessThanOrEqual(1);

    workspace.dispose();
  });

  test('a single-child folder chain is ONE row, and it expands into the deepest folder', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-chain');
    mkdirSync(join(workspace.path, 'com/java/app/package'), { recursive: true });
    writeFileSync(join(workspace.path, 'com/java/app/package/Main.java'), 'class Main {}\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFiles(page);
    const view = filesPanel(page);

    // One row for the whole chain: the reader does not scroll through `com`,
    // `java`, `app` to reach the files inside `package`.
    const row = view.row('com/java/app/package');
    await expect(row).toBeVisible();
    await expect(view.row('com')).toHaveCount(0);

    await row.click();
    await expect(view.row('Main.java')).toBeVisible();

    workspace.dispose();
  });

  test('a rename beside a chain unfolds it instead of drawing the folder twice', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-chain-unfold');
    mkdirSync(join(workspace.path, 'com/java/app/package'), { recursive: true });
    writeFileSync(join(workspace.path, 'com/java/app/package/Main.java'), 'class Main {}\n');
    writeFileSync(join(workspace.path, 'move.ts'), 'x\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFiles(page);
    const view = filesPanel(page);

    await expect(view.row('com/java/app/package')).toBeVisible();
    await view.row('move.ts').click({ button: 'right' });
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByLabel('Rename file path').fill('com/java/other/move.ts');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();

    // `com` now holds two branches, so the collapsed row is unfolded: one `com`
    // row, one `java` row beneath it, and both branches inside that. Drawing
    // the new `com` beside the old `com/java/...` row would list `java` twice.
    await expect(view.row('com/java')).toBeVisible();
    await expect(view.row('com')).toHaveCount(0);
    expect(existsSync(join(workspace.path, 'com/java/other/move.ts'))).toBe(true);

    workspace.dispose();
  });

  test('a refused rename keeps its dialog open with the reason', async ({ harness, page }) => {
    // `real`, not `mock`: a mock server answers the sidebar with its demo
    // presets, so `?folderId=` never resolves to the seeded folder and the
    // Files panel browses the bundled examples tree instead.
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-rename-refusal');
    writeFileSync(join(workspace.path, 'a.ts'), 'A\n');
    writeFileSync(join(workspace.path, 'b.ts'), 'B\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFiles(page);
    const view = filesPanel(page);

    await view.row('a.ts').click({ button: 'right' });
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByLabel('Rename file path').fill('b.ts');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();

    // The field is still there with the server's words beside it: "already
    // exists" is a message about what to type next, not a notification.
    await expect(page.getByLabel('Rename file path')).toBeVisible();
    await expect(page.getByText('b.ts already exists')).toBeVisible();
    // And the file it would have clobbered is untouched.
    expect(readdirSync(workspace.path).sort()).toEqual(['a.ts', 'b.ts']);

    workspace.dispose();
  });
  test('Unfold Folders exposes every level of a chain, and a rename moves THAT folder', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-chain-unfold-rename');
    mkdirSync(join(workspace.path, 'dev/src/main/code'), { recursive: true });
    writeFileSync(join(workspace.path, 'dev/src/main/code/a.ts'), 'A\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFiles(page);
    const view = filesPanel(page);

    // Four directories, one row. Nothing inside it can be addressed yet.
    const chainRow = view.row('dev/src/main/code');
    await expect(chainRow).toBeVisible();

    await chainRow.click({ button: 'right' });
    await page.getByRole('button', { name: 'Unfold Folders', exact: true }).click();

    // One row per directory, each open, so `main` is now a real row.
    await expect(view.row('dev')).toBeVisible();
    await expect(view.row('main')).toBeVisible();
    await expect(chainRow).toHaveCount(0);

    // Renaming `main` moves `main` — and its subtree with it.
    await view.row('main').click({ button: 'right' });
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(page.getByLabel('Rename folder path')).toHaveValue('dev/src/main');
    await page.getByLabel('Rename folder path').fill('dev2/src/main');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();

    await expect(view.row('dev2/src/main/code')).toBeVisible();
    expect(existsSync(join(workspace.path, 'dev2/src/main/code/a.ts'))).toBe(true);
    // The LEVELS BELOW `main` came with it. The old route left them behind
    // whenever the field named the deepest directory instead of `main` itself.
    expect(readdirSync(join(workspace.path, 'dev/src'))).toEqual([]);

    workspace.dispose();
  });

  test('a drag highlights only the row under the pointer, never the whole tree', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-drag-highlight');
    mkdirSync(join(workspace.path, 'aa'), { recursive: true });
    mkdirSync(join(workspace.path, 'bb'), { recursive: true });
    // Top-level FILES beside the two folders: every one of them is a legal
    // target for a drag of the other, which is what used to paint them all.
    writeFileSync(join(workspace.path, 'one.ts'), '1\n');
    writeFileSync(join(workspace.path, 'two.ts'), '2\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFiles(page);
    const view = filesPanel(page);
    const painted = page.locator('[data-panel-id="right-panel"] [class*="bg-info"]');

    // The tree is fully drawn: both folders and both files are legal targets.
    await expect(view.row('aa')).toBeVisible();
    await expect(view.row('bb')).toBeVisible();

    // Drive a real HTML5 drag with the mouse events Playwright sends, stopping
    // half-way over `aa` — the state a user sees while deciding where to drop.
    await view.row('one.ts').dragTo(view.row('aa'), { targetPosition: { x: 10, y: 8 } });

    // Whatever landed, at most ONE row may carry the block: the whole tree
    // painted at once was the reported "semua folder dan file terselect".
    const count = await painted.count();
    expect(count).toBeLessThanOrEqual(1);

    workspace.dispose();
  });

  test('dragging a file onto a chain level drops it in that folder, not the deepest one', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-chain-drop');
    mkdirSync(join(workspace.path, 'dev/src/main/code'), { recursive: true });
    writeFileSync(join(workspace.path, 'dev/src/main/code/keep.ts'), 'K\n');
    writeFileSync(join(workspace.path, 'moved.ts'), 'M\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openFiles(page);
    const view = filesPanel(page);

    // `main` has to be a ROW before anything can be dropped on it: unfolding is
    // what turns the chain's hidden levels into drop targets. The hover-unfold
    // path (a drag hovering the chain row) is pinned by `collapsed-chain.test.ts`
    // through a real DOM; here the menu performs the same unfold so this spec
    // measures the DROP, not two gestures at once.
    await view.row('dev/src/main/code').click({ button: 'right' });
    await page.getByRole('button', { name: 'Unfold Folders', exact: true }).click();
    await expect(view.row('main')).toBeVisible();

    await view.row('moved.ts').dragTo(view.row('main'));

    // The drop posts asynchronously, so the DISK is polled rather than read
    // once: `existsSync` immediately after `dragTo` races the request, and the
    // assertion then fails on a move that did land a moment later.
    await expect
      .poll(() => existsSync(join(workspace.path, 'dev/src/main/moved.ts')))
      .toBe(true);
    expect(existsSync(join(workspace.path, 'dev/src/main/code/moved.ts'))).toBe(false);

    workspace.dispose();
  });
});
