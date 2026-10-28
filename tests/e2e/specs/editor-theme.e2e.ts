/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor theme is a SECOND axis beside the app palette, and both halves
 * have to hold at once.
 *
 * Every claim here is invisible to a unit test, because each one is a resolved
 * COMPUTED style inside a real CodeMirror surface:
 *
 * - the editor paints its own surface while the console keeps the app palette;
 * - `Auto` returns the editor to the app palette with no reload;
 * - the choice survives a reload, which is what proves it went through
 *   `POST /api/settings` rather than a client-only store.
 *
 * The assertions read `getComputedStyle`, never a class name: a theme that sets
 * the variables but loses the cascade would pass a class check and paint the
 * wrong colour.
 *
 * The file is written by the fixture and lives in the temp workspace the
 * harness owns, so nothing lands in the repository.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import type { HarnessServer } from '../fixtures/server';

/** The Dracula editor theme's own surface, from `@shikijs/themes`. */
const DRACULA_BG = 'rgb(40, 42, 54)';
/** The shipped `paper` palette's ink. */
const PAPER_INK = 'rgb(20, 19, 16)';

const EDITOR = '[data-panel-id="editor-panel"]';

/**
 * Seed a workspace with one file, open the app on it, and open the file in the
 * editor column — the surface under test does not exist until a file does.
 */
async function openEditorFile(page: Page, server: HarnessServer): Promise<() => void> {
  const workspace = await seedWorkspace(server, 'e2e-editor-theme');
  const dir = join(workspace.path, 'src');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'theme-sample.js'), 'const answer = 42;\nconsole.log(answer);\n');

  await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
  await openFileFromTree(page);
  return () => workspace.dispose();
}

/**
 * Open the seeded file through the Files tree.
 *
 * A reload does NOT bring the tab back: `layout.openedFiles` is per SESSION and
 * this spec has no session, so the editor column is empty again. The reload
 * assertion is about the stored SETTING, not about tab restore — so the file is
 * reopened the way a user would, and the theme must already be applied to the
 * surface the first time it paints.
 */
async function openFileFromTree(page: Page): Promise<void> {
  await page.getByText('src', { exact: true }).first().click();
  await page.getByText('theme-sample.js', { exact: true }).first().click();
  await expect(page.locator(`${EDITOR} .cm-content`)).toBeVisible({ timeout: 20_000 });
}

test.describe('editor theme', () => {
  test('paints the editor while the console keeps the app palette, and survives a reload', async ({ harness, page }) => {
    // `real` mode, like `editor.e2e.ts`: MOCK seeds its own demo folders and
    // its Files tree lists those, so a spec's own workspace would never appear
    // in the tree it is asked to click.
    const server = await harness('real');
    const dispose = await openEditorFile(page, server);

    await page.getByRole('button', { name: 'Settings' }).first().click();
    await page.getByRole('button', { name: 'Appearance' }).click();

    // The editor theme cards are the ones carrying a colour swatch; the app
    // palette is a separate grid in the same panel.
    const draculaCard = page.getByRole('button', { name: /^Dracula Theme/ }).first();
    await expect(draculaCard).toBeVisible();

    // Wait for the write: a reload issued before the POST lands reads the old
    // value back, and the spec then fails for the wrong reason.
    const saved = page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/settings',
    );
    await draculaCard.click();
    await saved;

    // The editor repaints with no reload: the picker dispatches an event an
    // open editor subscribes to, because `appSettings` is a boot-time prop.
    const editor = page.locator(`${EDITOR} .cm-editor`).first();
    await expect
      .poll(async () => editor.evaluate((node) => getComputedStyle(node).backgroundColor))
      .toBe(DRACULA_BG);

    // The app palette is untouched: the two axes are independent.
    await expect(page.locator('html')).toHaveAttribute('data-theme-variant', 'light');

    // A reload re-reads the stored setting, so the surface is themed the first
    // time it paints — no second visit to Settings.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openFileFromTree(page);
    await expect
      .poll(async () => page.locator(`${EDITOR} .cm-editor`).first().evaluate((node) => getComputedStyle(node).backgroundColor))
      .toBe(DRACULA_BG);

    dispose();
  });

  test('Auto returns the editor to the app palette', async ({ harness, page }) => {
    // `real` mode, like `editor.e2e.ts`: MOCK seeds its own demo folders and
    // its Files tree lists those, so a spec's own workspace would never appear
    // in the tree it is asked to click.
    const server = await harness('real');
    const dispose = await openEditorFile(page, server);

    const editor = page.locator(`${EDITOR} .cm-editor`).first();
    const content = page.locator(`${EDITOR} .cm-content`);

    await page.getByRole('button', { name: 'Settings' }).first().click();
    await page.getByRole('button', { name: 'Appearance' }).click();

    const autoCard = page.getByRole('button', { name: /^Auto/ }).first();
    await expect(autoCard).toHaveAttribute('aria-pressed', 'true');

    // Transparent is what `auto` means: the panel's own palette shows through,
    // which is the state every install had before this setting existed.
    expect(await editor.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(DRACULA_BG);
    expect(await content.evaluate((node) => getComputedStyle(node).color)).toBe(PAPER_INK);

    // Select Dracula, then Auto, and the ink comes back to the app palette.
    await page.getByRole('button', { name: /^Dracula Theme/ }).first().click();
    await expect
      .poll(async () => content.evaluate((node) => getComputedStyle(node).color))
      .not.toBe(PAPER_INK);

    await autoCard.click();
    await expect
      .poll(async () => content.evaluate((node) => getComputedStyle(node).color))
      .toBe(PAPER_INK);

    dispose();
  });
});
