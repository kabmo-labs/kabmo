/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings: the modal opens, a change is written, and it survives a reload.
 *
 * The persistence half is the point. A settings write is a `POST /api/settings`
 * of only the keys the edit moved (`diffSettings`), stored in SQLite, and read
 * back into `window.__OMP_BOOTSTRAP__` on the next load — three separate hops a
 * unit test exercises in isolation and never together. The failure this catches
 * is a setting that looks saved (the toast fires, the control moves) and is
 * gone after a reload, which is exactly what a client-only update produces.
 *
 * The assertion reads the DOM (`<html data-theme-variant>`), not the store,
 * because the question a reader has is "is the page actually painted dark".
 */

import { test, expect, openApp } from '../fixtures/app';

test.describe('settings', () => {
  test('opens the settings modal and shows the category rail', async ({ app }) => {
    await app.getByRole('button', { name: 'Settings' }).first().click();
    await expect(app.getByRole('button', { name: 'Close settings' })).toBeVisible();
    await expect(app.getByRole('button', { name: 'Appearance' })).toBeVisible();
    await expect(app.getByRole('button', { name: 'Chats' })).toBeVisible();
  });

  test('a theme change is painted and survives a reload', async ({ app }) => {
    await app.getByRole('button', { name: 'Settings' }).first().click();
    await app.getByRole('button', { name: 'Appearance' }).click();

    // A family ships a light AND a dark palette under the same display name
    // ("Dracula"), so the grid's variant filter is what disambiguates them —
    // `.first()` on the name alone selects whichever variant sorts first.
    await app.getByRole('button', { name: 'Dark' }).first().click();
    const darkCard = app.getByRole('button', { name: /dracula/i }).first();
    await expect(darkCard).toBeVisible();

    // Wait for the write, not for a duration: a reload issued before the POST
    // lands reads the previous value back and the spec fails for the wrong
    // reason.
    const saved = app.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/settings',
    );
    await darkCard.click();
    await saved;

    // The document's own attribute is what every runtime consumer reads.
    await expect(app.locator('html')).toHaveAttribute('data-theme-variant', 'dark');

    // Reload IN PLACE. Calling `harness('mock')` here would start a SECOND
    // server while `app` is on the first, so the reload would read a database
    // the write never reached — the failure this spec first had.
    await app.reload({ waitUntil: 'domcontentloaded' });
    await expect(app.locator('html')).toHaveAttribute('data-theme-variant', 'dark');
  });

  /**
   * Settings → Chats is two screens on a phone, and the group list is real.
   *
   * A master/detail category looks finished on a desktop the moment both panes
   * fit; on a phone the failure is different — the detail pane sits in a
   * `display: none` subtree, so a row that selects a group without opening the
   * detail leaves the reader on the list with no way forward. Only a browser at
   * a phone width resolves which pane is displayed, so the drill, the back bar
   * and the absence of horizontal overflow are asserted here.
   */
  test('the Chats groups are a phone drill-down', async ({ harness, page }) => {
    const server = await harness('mock');
    await page.setViewportSize({ width: 412, height: 915 });
    await openApp(page, server.baseURL);

    await page.getByRole('button', { name: 'Open Sessions' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Chats' }).click();

    // The list first: the category never opens on a group the reader did not pick.
    for (const group of ['Layout', 'Transcript', 'Sessions', 'Keyboard']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${group}`) })).toBeVisible();
    }
    await expect(page.getByText('Chat Width', { exact: true })).toBeHidden();

    await page.getByRole('button', { name: /^Keyboard/ }).click();
    await expect(page.getByText('Keyboard Shortcuts', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to Chat settings' })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    await page.getByRole('button', { name: 'Back to Chat settings' }).click();
    await expect(page.getByRole('button', { name: /^Transcript/ })).toBeVisible();
  });
});
