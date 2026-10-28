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

import { test, expect } from '../fixtures/app';

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
});
