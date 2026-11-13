/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The stills the README's table and hero point at.
 *
 * Every capture here is a real state of the app: the heroes are the default
 * palette in both variants, the panel shots are the activity bar's own buttons
 * clicked in order, and the two montages are composed from eight (palettes) and
 * three (phone) separate captures rather than cropped out of one.
 */

import type { Browser } from '@playwright/test';
import { applyCaptureLook, openApp, openPanel, openSettings, setIconStyle, setSurfaceStyle, setTheme } from './app';
import { composeTo, shot, tile } from './output';

/** The README's desktop captures are all this size, so a row measures one height. */
export const DESKTOP = { width: 1600, height: 914 };
/** The phone captures share the tour table's aspect. */
export const PHONE = { width: 390, height: 844 };

/** The right-panel views, in the README's own order, as `[file, catalog title]`. */
const PANELS: Array<[string, string]> = [
  ['files', 'Files'],
  ['search', 'Search'],
  ['git', 'Source Control'],
  ['terminal', 'Terminal (Bun)'],
  ['context', 'Context & Telemetry'],
  ['wiki', 'Wiki'],
  ['todo', 'Todos'],
  ['plan', 'Plan (sesi ini)'],
  ['usage', 'Usage'],
  ['user-browser', 'Browser (Anda)'],
  ['agent-browser', 'Browser Agent'],
];

/** Eight palettes spanning all three families, four light and four dark. */
const MONTAGE: Array<[string, string]> = [
  ['paper', 'Paper'],
  ['contrast', 'Contrast'],
  ['one-dark-pro-soft', 'One Dark Pro Soft'],
  ['aura-dark', 'Aura Dark'],
  ['catppuccin-light', 'Catppuccin Light'],
  ['catppuccin-dark', 'Catppuccin Dark'],
  ['nord-light', 'Nord Light'],
  ['nord-dark', 'Nord Dark'],
];

/**
 * The two appearance axes, each pair captured on ONE surface and one palette so
 * the image compares the setting rather than the theme.
 */
const STYLES: Array<[Parameters<typeof setSurfaceStyle>[1], Parameters<typeof setIconStyle>[1], string]> = [
  ['classic', 'monochrome', 'Classic · Monochrome'],
  ['glass', 'monochrome', 'Glass · Monochrome'],
  ['classic', 'color', 'Classic · Full colour'],
  ['glass', 'color', 'Glass · Full colour'],
];

export async function captureShots(browser: Browser, baseURL: string, assetsDir: string): Promise<void> {
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1, colorScheme: 'dark' });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  console.log('desktop captures');
  await openApp(page, baseURL);
  // Stated before the first still: both settings are server-side, so every
  // later context (the montages, the phone) inherits them without repeating it.
  await applyCaptureLook(page);

  // The two heroes: the app as it opens, in the dark and light default palettes.
  await setTheme(page, 'aura-dark');
  await shot(page, assetsDir, 'hero-dark');
  await setTheme(page, 'paper');
  await shot(page, assetsDir, 'hero-light');

  // One capture per right-panel view, in the palette the table uses.
  await setTheme(page, 'aura-dark');
  for (const [file, title] of PANELS) {
    await openPanel(page, title);
    // A panel that opens on an empty state photographs as a broken feature.
    // Search needs a query, and the plan panel needs a document selected; both
    // name demo data (`server.ts`'s project, the mock plan list).
    if (file === 'search') {
      await page.getByPlaceholder('Search', { exact: true }).fill('format');
      await new Promise((done) => setTimeout(done, 1200));
    }
    if (file === 'plan') {
      await page.getByText('plan-panel', { exact: true }).first().click();
      await new Promise((done) => setTimeout(done, 800));
    }
    await shot(page, assetsDir, `panel-${file}`);
  }

  // The diff view: Source Control beside the editor column, with the demo
  // project's modified file open as a diff.
  await openPanel(page, 'Source Control');
  await page.getByText('format.ts', { exact: true }).first().click();
  await new Promise((done) => setTimeout(done, 1000));
  await shot(page, assetsDir, 'panel-diff');

  // Settings pages. The modal has no role, so a category is addressed by the
  // label its own sidebar row renders.
  await openSettings(page, 'Plugins Kabmo');
  await shot(page, assetsDir, 'settings-panel-plugins');
  await openSettings(page, 'Providers');
  await shot(page, assetsDir, 'settings-providers');
  await openSettings(page, 'Appearance');
  await shot(page, assetsDir, 'settings-themes');

  // The montage: the SAME surface under eight palettes, so the comparison is the
  // palette and nothing else — stated again, because `theme-styles` below walks
  // every combination and a later reordering must not leak one into a cell.
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await applyCaptureLook(page);
  const montage: string[] = [];
  for (const [id] of MONTAGE) {
    await setTheme(page, id);
    montage.push(await tile(page));
  }
  const montageContext = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const montagePage = await montageContext.newPage();
  await composeTo(montagePage, assetsDir, 'theme-grid', {
    width: 2350,
    height: 774,
    gap: 22,
    columns: 4,
    labels: MONTAGE.map(([, label]) => label),
  }, montage);
  await montageContext.close();

  // The two appearance axes: material and icon paint, on one palette, so the
  // image compares the SETTING and nothing else. Last on the desktop pass
  // because it leaves the document at glass + full colour.
  await setTheme(page, 'aura-dark');
  const styles: string[] = [];
  for (const [surface, icons] of STYLES) {
    await setSurfaceStyle(page, surface);
    await setIconStyle(page, icons);
    styles.push(await tile(page));
  }
  const styleContext = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const stylePage = await styleContext.newPage();
  await composeTo(stylePage, assetsDir, 'theme-styles', {
    // Two by two rather than one row of four: at a quarter width the per-icon
    // colour and the frosted rim shrink below what the image is meant to show.
    width: 2350,
    height: 1372,
    gap: 22,
    columns: 2,
    labels: STYLES.map(([, , label]) => label),
  }, styles);
  await styleContext.close();
  // PUT THE SHOT LOOK BACK. `theme-styles` ends on classic + monochrome, and the
  // phone captures below are still part of the main tour, so they must be shot
  // in the same material as the desktop stills.
  await applyCaptureLook(page);
  await context.close();

  console.log('phone captures');
  const phone = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const phonePage = await phone.newPage();
  await openApp(phonePage, baseURL);
  await setTheme(phonePage, 'aura-dark');

  // The triptych: the chat, the sessions drawer, the panel drawer — three real
  // states of the same phone session, not three crops of one.
  const triptych: string[] = [await tile(phonePage)];
  await phonePage.getByRole('button', { name: 'Open Sessions', exact: true }).click();
  await new Promise((done) => setTimeout(done, 700));
  triptych.push(await tile(phonePage));
  await phonePage.getByRole('button', { name: 'Close sidebar', exact: true }).click();
  await phonePage.getByRole('button', { name: 'Open Right Panel', exact: true }).click();
  await new Promise((done) => setTimeout(done, 700));
  triptych.push(await tile(phonePage));

  const phoneContext = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const composePage = await phoneContext.newPage();
  await composeTo(composePage, assetsDir, 'mobile', {
    width: DESKTOP.width,
    height: DESKTOP.height,
    gap: 56,
    columns: 3,
    labels: ['Chat', 'Sessions', 'Panels'],
  }, triptych);
  await phoneContext.close();
  await phone.close();

  if (pageErrors.length > 0) {
    throw new Error(`page errors during capture:\n${pageErrors.join('\n')}`);
  }
}
