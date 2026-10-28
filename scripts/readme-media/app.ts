/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Driving the app during a capture.
 *
 * Every helper here exists because the naive version was wrong at least once:
 * the update popup appears asynchronously and swallows the first click, the
 * settings modal cannot be reopened by clicking its own trigger, and a panel is
 * named by the catalog rather than by a selector. Keeping them in one module
 * means the shots and the video share exactly these behaviours.
 */

import type { Page } from '@playwright/test';

/** Wait for the shell to stop moving: fonts, the theme sheet and the first paint. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await new Promise((done) => setTimeout(done, 400));
}

/**
 * Open the app with the startup overlay dismissed.
 *
 * MOCK answers "an update is available" on every boot, so the Update dialog
 * opens over the whole app and its `fixed inset-0` backdrop swallows clicks.
 * The check is asynchronous, which is why this is a locator HANDLER and not a
 * single click: it fires whenever the button appears, including after a reload.
 * `exact` matters — `getByRole(name:)` matches substrings, and a session title
 * containing "Later" would otherwise be clicked instead.
 */
export async function openApp(page: Page, url: string): Promise<void> {
  await page.addLocatorHandler(page.getByRole('button', { name: 'Later', exact: true }), async (button) => {
    await button.click();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="app-root"]').waitFor({ state: 'visible', timeout: 60_000 });
  await settle(page);
}

/**
 * Pick a palette the way the settings panel does, then prove it took.
 *
 * Written through the settings route rather than clicked, because a capture
 * needs the same surface under eight palettes in a row and the picker's grid is
 * virtualized — a card for a palette that is not in view cannot be clicked.
 */
export async function setTheme(page: Page, themeId: string): Promise<void> {
  await page.evaluate(async (id) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kabmo_settings: { theme: id } }),
    });
  }, themeId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="app-root"]').waitFor({ state: 'visible' });
  await settle(page);
  const applied = await page.evaluate(() => document.documentElement.dataset.theme);
  if (applied !== themeId) throw new Error(`theme did not apply: wanted ${themeId}, document says ${applied}`);
}

/**
 * The right-panel view's own button, addressed by the title the catalog
 * declares (`panels/builtin.tsx`), which is also its accessible name.
 */
export async function openPanel(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: title, exact: true }).first().click();
  await new Promise((done) => setTimeout(done, 600));
}

/**
 * Open the settings modal on a category, by the sidebar row's own label.
 *
 * The modal stays open between categories — clicking `Settings` while it is
 * already up lands on its backdrop, which intercepts the click — so this only
 * opens the dialog when it is not already showing.
 */
export async function openSettings(page: Page, category: string): Promise<void> {
  const close = page.getByRole('button', { name: 'Close settings', exact: true });
  if (!(await close.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await close.waitFor({ state: 'visible' });
  }
  await page.getByRole('button', { name: category, exact: true }).first().click();
  await new Promise((done) => setTimeout(done, 600));
}
