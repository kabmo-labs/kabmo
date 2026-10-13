/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Files panel's clipboard, driven through the assembled product: a real
 * server, a real workspace on disk, and Chromium.
 *
 * This is the layer the unit specs cannot reach. They assert the request the
 * panel posted; this asserts what the FILESYSTEM says afterwards — which is the
 * only observable a paste actually has. A panel that posted the right fields to
 * a route that resolved them wrongly would pass every unit test and destroy a
 * file here.
 *
 * The workspace is a real temp directory seeded with a small tree, created
 * through `POST /api/folders` (never by writing the database), so the panel's
 * scope resolution and the server's root allow-list are the real ones.
 */

import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import type { SeededWorkspace } from '../fixtures/seed';

/** Seed the workspace directory with the tree the spec drives. */
function seedTree(workspace: SeededWorkspace): void {
  mkdirSync(join(workspace.path, 'src', 'deep'), { recursive: true });
  mkdirSync(join(workspace.path, 'target'), { recursive: true });
  writeFileSync(join(workspace.path, 'a.ts'), 'A');
  writeFileSync(join(workspace.path, 'dest.ts'), 'K');
  writeFileSync(join(workspace.path, 'src', 'b.ts'), 'B');
  writeFileSync(join(workspace.path, 'src', 'deep', 'c.ts'), 'C');
  writeFileSync(join(workspace.path, 'target', 'keep.ts'), 'T');
}

/**
 * Open the app on the workspace with the Files panel showing.
 *
 * The panel is NOT selected by clicking its activity-bar button: `files` is the
 * default view, and clicking the active view's button collapses the panel —
 * the placeholder stays visible for the 200ms width transition and then the
 * panel is 0px wide, so the collapse surfaced as "element is not visible" on
 * whatever the spec clicked next.
 */
async function openFilesPanel(page: import('@playwright/test').Page, baseURL: string, workspace: SeededWorkspace): Promise<void> {
  await openApp(page, `${baseURL}/?folderId=${workspace.id}`);
  await expect(page.getByPlaceholder('Search files...')).toBeVisible();
  // The workspace's tree has landed: the panel renders entries, not the
  // "Loading files..." placeholder, and a click can only land on a real row.
  await expect(page.getByText('a.ts', { exact: true }).first()).toBeVisible();
}

test.describe('files panel clipboard', () => {
  test('Cut then Paste into a folder moves the file on disk', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-clip-cut');
    seedTree(workspace);
    await openFilesPanel(page, server.baseURL, workspace);

    // Cut a.ts, then paste it into target/.
    await page.getByText('a.ts', { exact: true }).first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Cut', exact: true }).click();

    await page.getByText('target', { exact: true }).first().click({ button: 'right' });
    const paste = page.getByRole('button', { name: 'Paste a.ts', exact: true });
    await expect(paste).toBeVisible();
    await paste.click();

    // The observable is the disk, not the tree: the file MOVED.
    await expect
      .poll(() => existsSync(join(workspace.path, 'target', 'a.ts')))
      .toBe(true);
    expect(existsSync(join(workspace.path, 'a.ts'))).toBe(false);
    expect(readFileSync(join(workspace.path, 'target', 'a.ts'), 'utf8')).toBe('A');

    workspace.dispose();
  });

  test('Copy leaves the source, and a second paste takes a free name', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-clip-copy');
    seedTree(workspace);
    await openFilesPanel(page, server.baseURL, workspace);

    await page.getByText('dest.ts', { exact: true }).first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Copy', exact: true }).click();

    for (let paste = 0; paste < 2; paste += 1) {
      await page.getByText('target', { exact: true }).first().click({ button: 'right' });
      const row = page.getByRole('button', { name: 'Paste dest.ts', exact: true });
      await expect(row).toBeVisible();
      await row.click();
    }

    await expect.poll(() => existsSync(join(workspace.path, 'target', 'dest copy.ts'))).toBe(true);
    expect(readFileSync(join(workspace.path, 'dest.ts'), 'utf8')).toBe('K');
    expect(readFileSync(join(workspace.path, 'target', 'dest.ts'), 'utf8')).toBe('K');
    expect(readFileSync(join(workspace.path, 'target', 'dest copy.ts'), 'utf8')).toBe('K');

    workspace.dispose();
  });

  test('Duplicate copies a folder beside itself on disk', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-clip-dup');
    seedTree(workspace);
    await openFilesPanel(page, server.baseURL, workspace);

    await page.getByText('src', { exact: true }).first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();

    await expect.poll(() => existsSync(join(workspace.path, 'src copy', 'deep', 'c.ts'))).toBe(true);
    expect(readFileSync(join(workspace.path, 'src copy', 'deep', 'c.ts'), 'utf8')).toBe('C');
    expect(readFileSync(join(workspace.path, 'src', 'deep', 'c.ts'), 'utf8')).toBe('C');

    workspace.dispose();
  });

  test('a paste onto the panel background moves an entry out to the listing root', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-clip-root');
    seedTree(workspace);
    await openFilesPanel(page, server.baseURL, workspace);

    // Expand `src` so its child is on screen, then cut that child.
    await page.getByText('src', { exact: true }).first().click();
    await expect(page.getByText('b.ts', { exact: true }).first()).toBeVisible();
    await page.getByText('b.ts', { exact: true }).first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Cut', exact: true }).click();

    // The background's own menu — the only way to move an entry back OUT of a
    // folder, since the tree offers no drag. `b.ts` is not at the root, so the
    // paste is a real move rather than the same-folder refusal.
    //
    // Clicked at the scroller's own empty area below the last row: a right-click
    // that lands ON a row stops propagation and opens the ROW menu instead, and
    // the panel's `p-2` padding leaves too little room at the top.
    const scroller = page.locator('[data-panel-id="right-panel"] .scrollbar-overlay-container.p-2');
    const box = (await scroller.boundingBox())!;
    await scroller.click({ button: 'right', position: { x: box.width / 2, y: box.height - 8 } });
    const paste = page.getByRole('button', { name: 'Paste b.ts', exact: true });
    await expect(paste).toBeVisible();
    await paste.click();

    await expect.poll(() => existsSync(join(workspace.path, 'b.ts'))).toBe(true);
    expect(existsSync(join(workspace.path, 'src', 'b.ts'))).toBe(false);
    expect(readFileSync(join(workspace.path, 'b.ts'), 'utf8')).toBe('B');

    workspace.dispose();
  });

  test('dragging a file onto a folder moves it there on disk', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-drag-file');
    seedTree(workspace);
    await openFilesPanel(page, server.baseURL, workspace);

    // Playwright's own drag gesture: it raises dragstart/dragover/drop with a
    // real DataTransfer, which is the only way to exercise the handlers.
    await page.getByText('a.ts', { exact: true }).first().dragTo(page.getByText('target', { exact: true }).first());

    await expect.poll(() => existsSync(join(workspace.path, 'target', 'a.ts'))).toBe(true);
    expect(existsSync(join(workspace.path, 'a.ts'))).toBe(false);
    expect(readFileSync(join(workspace.path, 'target', 'a.ts'), 'utf8')).toBe('A');

    workspace.dispose();
  });

  test('dragging an entry onto the panel background moves it to the listing root', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-drag-root');
    seedTree(workspace);
    await openFilesPanel(page, server.baseURL, workspace);

    // Expand `src` so its child is a drop source, then drag it onto the empty
    // background below the last row — the listing root's own drop target.
    await page.getByText('src', { exact: true }).first().click();
    await expect(page.getByText('b.ts', { exact: true }).first()).toBeVisible();
    const scroller = page.locator('[data-panel-id="right-panel"] .scrollbar-overlay-container.p-2');
    const box = (await scroller.boundingBox())!;
    await page.getByText('b.ts', { exact: true }).first().dragTo(scroller, {
      targetPosition: { x: box.width / 2, y: box.height - 8 },
    });

    await expect.poll(() => existsSync(join(workspace.path, 'b.ts'))).toBe(true);
    expect(existsSync(join(workspace.path, 'src', 'b.ts'))).toBe(false);

    workspace.dispose();
  });

  test('dragging a file onto the folder it already lives in changes nothing', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-drag-noop');
    seedTree(workspace);
    await openFilesPanel(page, server.baseURL, workspace);

    await page.getByText('src', { exact: true }).first().click();
    await expect(page.getByText('b.ts', { exact: true }).first()).toBeVisible();
    // Onto its own parent folder: a no-op, and the file must stay put.
    await page.getByText('b.ts', { exact: true }).first().dragTo(page.getByText('src', { exact: true }).first());

    // The assertion is the ABSENCE of a move, so it needs a settle rather than
    // a poll: a paste that wrongly ran would land `b.ts` at the root as well.
    await page.waitForTimeout(1500);
    expect(existsSync(join(workspace.path, 'src', 'b.ts'))).toBe(true);
    expect(existsSync(join(workspace.path, 'b.ts'))).toBe(false);

    workspace.dispose();
  });
});
