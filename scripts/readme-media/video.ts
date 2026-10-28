/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two recordings: the feature tour and the palette cycle.
 *
 * Both are recorded at 1400x800 rather than the stills' 1600x914, because a GIF
 * of a 1600px page is tens of megabytes. Each measures its own intro — the time
 * from `newContext` to the first settled frame — and hands that to the encode,
 * so the output opens on the app instead of on a blank page and a theme flash.
 */

import type { Browser } from '@playwright/test';
import { openApp, settle, setTheme } from './app';
import { encodeThemeCycle, encodeTour } from './output';

const VIDEO_VIEWPORT = { width: 1400, height: 800 };
const VIDEO_SIZE = { width: 1400, height: 800 };

function pause(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** The tour: a beat on each surface, in the order the README describes them. */
async function recordTour(browser: Browser, baseURL: string, assetsDir: string, framesDir: string): Promise<void> {
  console.log('tour recording');
  const context = await browser.newContext({
    viewport: VIDEO_VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: framesDir, size: VIDEO_SIZE },
  });
  const started = Date.now();
  const page = await context.newPage();
  await openApp(page, baseURL);
  await setTheme(page, 'aura-dark');
  await settle(page);
  const introMs = Date.now() - started;

  // The transcript first — the page's opening claim — then the panels.
  const scroller = page.locator('.scrollbar-overlay-container').first();
  for (let step = 0; step < 4; step += 1) {
    await scroller.evaluate((element, delta) => element.scrollBy({ top: delta }), 380);
    await pause(700);
  }
  await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
  await pause(900);

  const tour: Array<[string, number]> = [
    ['Files', 2400],
    ['Search', 2000],
    ['Source Control', 2400],
    ['Terminal (Bun)', 2800],
    ['Context & Telemetry', 2400],
    ['Wiki', 2400],
    ['Todos', 2200],
    ['Usage', 2200],
  ];
  for (const [title, hold] of tour) {
    await page.getByRole('button', { name: title, exact: true }).first().click();
    await pause(hold);
  }

  const video = page.video();
  await context.close();
  if (!video) throw new Error('no video was recorded');
  await encodeTour(await video.path(), assetsDir, introMs);
}

/**
 * The cycle: eight palettes clicked in the palette grid, so the recording shows
 * the picker changing the surface it describes.
 *
 * A card is addressed by the NAME it renders (`title` on its name span); two
 * cards share a name — a light and a dark variant — so the variant badge picks
 * between them.
 */
async function recordThemeCycle(browser: Browser, baseURL: string, assetsDir: string, framesDir: string): Promise<void> {
  console.log('theme cycle recording');
  const context = await browser.newContext({
    viewport: VIDEO_VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: framesDir, size: VIDEO_SIZE },
  });
  const started = Date.now();
  const page = await context.newPage();
  await openApp(page, baseURL);
  await settle(page);
  const introMs = Date.now() - started;

  const cycle: Array<[string, string]> = [
    ['E-Ink Paper', 'light'],
    ['High Contrast', 'light'],
    ['One Dark Pro Soft', 'dark'],
    ['Aura', 'dark'],
    ['Catppuccin', 'light'],
    ['Catppuccin', 'dark'],
    ['Nord', 'light'],
    ['Nord', 'dark'],
  ];

  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).first().click();
  await pause(900);
  for (const [name, variant] of cycle) {
    const card = page.locator(`button:has(span[title="${name}"]):has-text("${variant}")`).first();
    if ((await card.count()) === 0) {
      throw new Error(`no palette card named "${name}" (${variant}) — the catalog changed`);
    }
    await card.click();
    await pause(1500);
  }

  const video = page.video();
  await context.close();
  if (!video) throw new Error('no theme video was recorded');
  await encodeThemeCycle(await video.path(), assetsDir, introMs);
}

export async function captureVideo(
  browser: Browser,
  baseURL: string,
  assetsDir: string,
  framesDir: string,
): Promise<void> {
  await recordTour(browser, baseURL, assetsDir, framesDir);
  await recordThemeCycle(browser, baseURL, assetsDir, framesDir);
}
