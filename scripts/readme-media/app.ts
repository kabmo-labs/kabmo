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
 * Store one `kabmo_settings` patch, reload, and prove every attribute it names.
 *
 * Written through the settings route for the same reason `setTheme` is: the
 * capture needs one surface under several palettes/materials in a row, and a
 * card for a value that is not in view cannot be clicked. The verification is
 * per KEY, because a default is REMOVED from `<html>` rather than written
 * (`applySurfaceStyle`/`applyIconStyle`), so "did it apply" is
 * `attribute === expected` with `null` standing for the default.
 */
async function applyAppearance(
  page: Page,
  patch: Record<string, unknown>,
  attributes: Record<string, string | null>,
): Promise<void> {
  await page.evaluate(async (body) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }, { kabmo_settings: patch });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="app-root"]').waitFor({ state: 'visible' });
  await settle(page);
  const actual = await page.evaluate(
    (names) =>
      Object.fromEntries(names.map((name) => [name, document.documentElement.getAttribute(name)])) as Record<
        string,
        string | null
      >,
    Object.keys(attributes),
  );
  for (const [name, expected] of Object.entries(attributes)) {
    if (actual[name] !== expected) {
      throw new Error(`${name} did not apply: wanted ${expected ?? 'the default (absent)'}, document says ${actual[name]}`);
    }
  }
}

/** Pick a surface material: the attribute is absent for the opaque default. */
export async function setSurfaceStyle(page: Page, style: 'classic' | 'glass'): Promise<void> {
  await applyAppearance(page, { surfaceStyle: style }, { 'data-surface': style === 'classic' ? null : style });
}

/** Pick an icon paint: the attribute is absent for the ink default. */
export async function setIconStyle(page: Page, style: 'monochrome' | 'color'): Promise<void> {
  await applyAppearance(page, { iconStyle: style }, { 'data-icon-style': style === 'monochrome' ? null : style });
}

/**
 * The appearance every capture on the README is taken in.
 *
 * The stills and both recordings show the product as this build ships it, so
 * they use the material and icon paint it leads with — glass and full colour —
 * rather than the upgrade-safe defaults a fresh profile still starts at. One
 * pair of constants rather than a literal per script, because the tour and the
 * stills sit on one page and a mismatch is visible side by side. The image that
 * states the CHOICE instead of the look is `theme-styles`, which captures all
 * four combinations on purpose.
 */
export const CAPTURE_SURFACE = 'glass' as const;
export const CAPTURE_ICON_STYLE = 'color' as const;

/** Apply `CAPTURE_SURFACE`/`CAPTURE_ICON_STYLE` to the open document. */
export async function applyCaptureLook(page: Page): Promise<void> {
  await setSurfaceStyle(page, CAPTURE_SURFACE);
  await setIconStyle(page, CAPTURE_ICON_STYLE);
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
