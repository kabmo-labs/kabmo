/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Browser (Anda): several tabs, each with its own page, and a two-row toolbar.
 *
 * What only a real browser can prove here:
 *
 * - The strip, the address row and the controls row are three separate bands,
 *   measured as rects: the split is the request, and a wrapper that collapsed
 *   them back into one row would still pass a DOM query.
 * - A tab switch keeps BOTH documents mounted. Two tabs pointed at two local
 *   pages, switched back and forth, must leave two live iframes with their own
 *   `src` — the failure this prevents is "switching reloads the page and loses
 *   the form/scroll you had".
 * - Back is per tab: the second tab's Back cannot reach the first tab's page.
 *
 * The pages are served by the spec itself through `page.route`, so the targets
 * are stable strings the assertions can read back out of the iframes' `src`.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import type { Page } from '@playwright/test';

const PAGE_A = 'https://a.kabmo.test/one';
const PAGE_B = 'https://b.kabmo.test/two';

/** Answer both fake origins so no iframe leaves the machine. */
async function servePages(page: Page): Promise<void> {
  await page.route(/https:\/\/(a|b)\.kabmo\.test\/.*/, async (route) => {
    const host = new URL(route.request().url()).hostname;
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><body style="font:16px system-ui;padding:24px"><h1>${host}</h1></body></html>`,
    });
  });
}

/** The frame band's iframes, in tab order, with the visible one flagged. */
async function framesOf(page: Page) {
  const wrappers = page.locator('[data-user-browser-tab]');
  return wrappers.evaluateAll((nodes) =>
    nodes.map((node) => {
      const frame = node.querySelector('iframe');
      const hidden = node.className.includes('hidden');
      return { src: frame?.getAttribute('src') ?? '', hidden };
    }),
  );
}

test.describe('user browser tabs', () => {
  test('each tab keeps its own page mounted, and the toolbar is two rows', async ({ harness, page }) => {
    const server = await harness('mock');
    const workspace = await seedWorkspace(server, 'e2e-user-browser');
    await servePages(page);
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    await page.getByRole('button', { name: 'Browser (Anda)' }).click();
    // Both browser views stay MOUNTED while one is on screen, so every locator
    // is scoped to the user panel's own root — the agent view renders a toolbar
    // with the same bands.
    const panel = page.locator('[data-user-browser-panel]');

    // Row 1 is navigation + address; row 2 is the trailing controls, and the
    // strip sits above both. Compare MEASURED boxes, not class names.
    // The user panel is the one with the two-row bar (the agent view stays one
    // row), so locate it by the band only IT renders.
    const addressRow = panel.locator('[data-toolbar-band="address"]');
    const controlsRow = panel.locator('[data-toolbar-band="controls"]');
    await expect(addressRow).toBeVisible();
    await expect(controlsRow).toBeVisible();

    // Measured bands: strip above address above controls.
    const stripBox = await panel.locator('[data-toolbar-band="strip"]').boundingBox();
    const addressBox = await addressRow.boundingBox();
    const controlsBox = await controlsRow.boundingBox();
    expect(stripBox!.y).toBeLessThan(addressBox!.y);
    expect(addressBox!.y).toBeLessThan(controlsBox!.y);
    // The editable field is on the ADDRESS row, not beside the controls.
    expect(await addressRow.getByLabel('Browser address').count()).toBe(1);
    expect(await controlsRow.getByLabel('Browser address').count()).toBe(0);

    // Tab 1 → page A.
    const address = panel.getByLabel('Browser address');
    await address.fill(PAGE_A);
    await address.press('Enter');
    await expect(panel.locator('[data-user-browser-tab] iframe')).toHaveAttribute('src', PAGE_A);

    // Tab 2 → page B.
    await panel.getByRole('button', { name: 'Tab baru' }).click();
    await address.fill(PAGE_B);
    await address.press('Enter');
    await expect.poll(() => framesOf(page)).toEqual([
      { src: PAGE_A, hidden: true },
      { src: PAGE_B, hidden: false },
    ]);

    // Switching back must NOT reload: both documents stay mounted, only the
    // visibility moves.
    await panel.getByRole('button', { name: /^Tab a\.kabmo\.test\/one/ }).click();
    await expect.poll(() => framesOf(page)).toEqual([
      { src: PAGE_A, hidden: false },
      { src: PAGE_B, hidden: true },
    ]);
    await expect(address).toHaveValue(PAGE_A);
  });

  test('Back is per tab, and closing the active tab keeps a page on screen', async ({ harness, page }) => {
    const server = await harness('mock');
    const workspace = await seedWorkspace(server, 'e2e-user-browser-back');
    await servePages(page);
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    await page.getByRole('button', { name: 'Browser (Anda)' }).click();
    // Both browser views stay MOUNTED while one is on screen, so every locator
    // is scoped to the user panel's own root — the agent view renders a toolbar
    // with the same bands.
    const panel = page.locator('[data-user-browser-panel]');
    const address = panel.getByLabel('Browser address');
    await address.fill(PAGE_A);
    await address.press('Enter');
    await address.fill('https://a.kabmo.test/two');
    await address.press('Enter');
    await expect(panel.getByLabel('Reload')).toBeEnabled();
    await expect(address).toHaveValue('https://a.kabmo.test/two');

    await panel.getByRole('button', { name: 'Tab baru' }).click();
    await address.fill(PAGE_B);
    await address.press('Enter');

    // The new tab has nothing behind it.
    await expect(panel.getByRole('button', { name: 'Maju' })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Back' })).toBeDisabled();
    await expect(address).toHaveValue(PAGE_B);

    // Close the active (second) tab: the first one, still on its own page,
    // becomes the view.
    await panel.getByRole('button', { name: /^Tutup tab b\.kabmo\.test/ }).click();
    await expect.poll(() => framesOf(page)).toEqual([
      { src: 'https://a.kabmo.test/two', hidden: false },
    ]);
    await expect(address).toHaveValue('https://a.kabmo.test/two');
    // …and its Back works, because its history was never the other tab's.
    await panel.getByRole('button', { name: 'Back' }).click();
    await expect(address).toHaveValue(PAGE_A);
  });
});
