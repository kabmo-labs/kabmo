/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Writing and encoding the captures.
 *
 * Two things live here that a caller would otherwise get wrong. A montage is
 * composed from real captures rather than cropped, so the same surface is
 * compared under different palettes; and the video encode trims the measured
 * intro, so the tour opens on the app instead of on a blank page and a theme
 * flash.
 */

import type { Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

/** One `ffmpeg` run, with the failure surfaced instead of swallowed. */
async function ffmpeg(args: string[]): Promise<void> {
  const child = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  const { promise, resolve } = Promise.withResolvers<number>();
  child.once('exit', (value) => resolve(value ?? 1));
  const code = await promise;
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
}

/** Write one still at the size the README's table expects. */
export async function shot(page: Page, assetsDir: string, name: string): Promise<void> {
  await page.screenshot({ path: join(assetsDir, `${name}.png`), animations: 'disabled' });
  console.log(`  ${name}.png`);
}

/** Read the current surface back as a base64 PNG, for the compositor. */
export async function tile(page: Page): Promise<string> {
  return (await page.screenshot({ animations: 'disabled' })).toString('base64');
}

/**
 * Lay several captures out on one canvas, in the page's own background.
 *
 * Two README images are montages rather than single screenshots: the phone row
 * (chat, sessions drawer, panel drawer) and the palette grid. Both are composed
 * here from real captures instead of hand-assembled, so a recapture rebuilds
 * them and the row still measures one height.
 *
 * The tiles are fitted with `max-width`/`max-height`, never a fixed `height` with
 * `object-fit: cover`: a phone capture is 390x844 and a cell in this row is
 * taller than it is wide, so filling the cell would cut the header — the one
 * place the wordmark appears — out of the image. Fitting letterboxes instead,
 * and the caption names the state.
 */
export async function compose(
  page: Page,
  layout: { width: number; height: number; gap: number; columns: number; labels: string[] },
  tiles: string[],
): Promise<void> {
  const { width, height, gap, columns, labels } = layout;
  const rows = Math.ceil(tiles.length / columns);
  const cellW = Math.round((width - gap * (columns + 1)) / columns);
  const cellH = Math.round((height - gap * (rows + 1)) / rows);

  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: #f4f1ea; }
    body { display: grid; grid-template-columns: repeat(${columns}, ${cellW}px); gap: ${gap}px; padding: ${gap}px; }
    figure { margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .frame { height: ${cellH - 22}px; display: flex; align-items: center; justify-content: center; }
    img { max-width: 100%; max-height: 100%; border-radius: 6px; display: block; }
    figcaption { font: 600 11px/1.2 -apple-system, system-ui, sans-serif; color: #141310; text-align: center; }
  </style></head><body>${tiles
    .map((src, index) => `<figure><div class="frame"><img src="data:image/png;base64,${src}"></div><figcaption>${labels[index] ?? ''}</figcaption></figure>`)
    .join('')}</body></html>`);
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
}

/** Write a composed canvas to `name.png`. */
export async function composeTo(
  page: Page,
  assetsDir: string,
  name: string,
  layout: { width: number; height: number; gap: number; columns: number; labels: string[] },
  tiles: string[],
): Promise<void> {
  await compose(page, layout, tiles);
  await page.screenshot({ path: join(assetsDir, `${name}.png`), animations: 'disabled' });
  console.log(`  ${name}.png`);
}

/**
 * Encode the tour into its two formats.
 *
 * `introMs` is the measured time from recording start to the first settled
 * frame: it is trimmed from both outputs, so the tour opens on the app instead
 * of on a blank page and a theme flash. The GIF is built from a palette of its
 * own and capped at 5 fps — a minute of 1400px at full rate is a
 * hundred-megabyte file, and the README's copy has always been the 1000px
 * version.
 */
export async function encodeTour(source: string, assetsDir: string, introMs: number): Promise<void> {
  const trim = ['-ss', (introMs / 1000).toFixed(2)];
  await ffmpeg([
    ...trim,
    '-i', source,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '23',
    '-preset', 'medium',
    '-movflags', '+faststart',
    join(assetsDir, 'tour.mp4'),
  ]);

  await ffmpeg([
    ...trim,
    '-i', source,
    '-vf', 'fps=5,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192[p];[b][p]paletteuse=dither=sierra2_4a',
    '-loop', '0',
    join(assetsDir, 'tour.gif'),
  ]);
}

/** The theme cycle is short, so it gets a higher frame rate and a tighter palette. */
export async function encodeThemeCycle(source: string, assetsDir: string, introMs: number): Promise<void> {
  await ffmpeg([
    '-ss', (introMs / 1000).toFixed(2),
    '-i', source,
    '-vf', 'fps=8,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192[p];[b][p]paletteuse=dither=sierra2_4a',
    '-loop', '0',
    join(assetsDir, 'themes.gif'),
  ]);
}
