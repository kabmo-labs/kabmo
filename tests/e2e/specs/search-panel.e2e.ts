/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A search hit on a file that is ALREADY open.
 *
 * The bug this pins was invisible to every unit test that came before it,
 * because the two surfaces hand the editor the same PATH under two different
 * tab ids: the explorer passes the row's own `id` (its relative path), while a
 * search row computes `fileTabId(path)`. `handleOpenFile` activated the id it
 * had computed even after matching an existing tab, so the active id named no
 * tab — the editor drew "Select a tab to view content" over the file that was
 * already open, with the tab strip still showing it.
 *
 * Asserted on the EDITOR'S OWN TEXT, not on the tab strip: the strip looked
 * correct throughout, which is exactly why the failure read as a missing file
 * rather than a bad id.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

test.describe('search panel', () => {
  test('clicking a hit on an already-open file keeps it on screen', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-search');
    const dir = join(workspace.path, 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.ts'), 'export const alpha = 1;\nconst beta = alpha + 2;\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    const editorPanel = page.locator('[data-panel-id="editor-panel"]');
    const rightPanel = page.locator('[data-panel-id="right-panel"]');

    // Open the file from the EXPLORER first: that is the path that gives the
    // tab the row's own id, which is what a search click then has to match.
    await rightPanel.getByText('src', { exact: true }).first().click();
    await rightPanel.getByText('a.ts', { exact: true }).first().click();
    await expect(editorPanel.locator('.cm-content')).toContainText('beta', { timeout: 15_000 });

    // Now the same file through a search hit.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const searchField = page.getByPlaceholder('Search', { exact: true });
    await searchField.fill('beta');

    const hit = page.locator('[data-search-hit] button').first();
    await expect(hit).toBeVisible({ timeout: 15_000 });
    await hit.click();

    // The file is still the document on screen — not the empty notice.
    await expect(editorPanel.getByText('Select a tab to view content')).toHaveCount(0);
    await expect(editorPanel.locator('.cm-content')).toContainText('beta', { timeout: 15_000 });

    workspace.dispose();
  });

  test('both fields carry a clear button inside them', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-search-clear');
    mkdirSync(join(workspace.path, 'src'), { recursive: true });
    writeFileSync(join(workspace.path, 'src', 'a.ts'), 'const beta = 2;\n');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const searchField = page.getByPlaceholder('Search', { exact: true });
    const replaceField = page.getByPlaceholder('Replace', { exact: true });

    // Nothing to clear means no button — an always-present × can do nothing.
    await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(0);

    await searchField.fill('beta');
    await replaceField.fill('BETA');
    const clearSearch = page.getByRole('button', { name: 'Clear search' });
    const clearReplace = page.getByRole('button', { name: 'Clear replace' });
    await expect(clearSearch).toBeVisible();
    await expect(clearReplace).toBeVisible();

    // INSIDE the field's own box, which is the whole point of the control: a
    // button beside the input reads as clearing the panel instead. The box
    // measured is the wrapper the input and the button SHARE — the `<input>`
    // itself ends where the button begins, so measuring it would say "outside"
    // for a control that is plainly inside.
    const fieldBox = await searchField.evaluate((input) => {
      const box = input.parentElement!.getBoundingClientRect();
      return { x: box.x, right: box.right };
    });
    const clearBox = await clearSearch.boundingBox();
    expect(clearBox).toBeTruthy();
    expect(clearBox!.x).toBeGreaterThanOrEqual(fieldBox.x - 1);
    expect(clearBox!.x + clearBox!.width).toBeLessThanOrEqual(fieldBox.right + 1);

    await clearReplace.click();
    await expect(replaceField).toHaveValue('');
    // The reason to clear is to retype, so the field keeps focus.
    await expect(replaceField).toBeFocused();

    await clearSearch.click();
    await expect(searchField).toHaveValue('');
    await expect(searchField).toBeFocused();
    await expect(page.getByRole('button', { name: 'Clear search' })).toHaveCount(0);

    workspace.dispose();
  });
});
