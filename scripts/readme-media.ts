/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The README's media, captured from a real MOCK server.
 *
 * The images in `docs/assets` were produced by hand once, which is why a
 * recapture meant rediscovering every navigation step. This script is that
 * knowledge written down: it boots an isolated `MOCK=true` server, drives the
 * real UI through Playwright, and writes every screenshot, the tour video and
 * both GIFs at the sizes the README references.
 *
 * Three rules are load-bearing, and each lives in the module that owns it.
 *
 * 1. **The capture never touches the developer's install.** `server.ts` gives
 *    the app its own data dir, database, agent dir and marketplace root under
 *    one temp directory, so no real session, path or repository can appear in a
 *    published image.
 * 2. **A step waits on the UI, never on a clock.** `app.ts` asserts the surface
 *    it asked for, because a sleep long enough for a loaded machine is a wasted
 *    second on an idle one and still races the slower case.
 * 3. **Every capture is deterministic.** The update popup MOCK raises on each
 *    boot is dismissed through a locator handler (it appears asynchronously),
 *    the palette is set explicitly and verified, and the viewport is fixed — so
 *    a diff between two runs is a real change, not noise.
 *
 * Run it with the repo's own Playwright, which is a dev dependency:
 *
 * ```bash
 * bun run readme:media            # everything
 * bun run readme:media --shots    # screenshots only
 * bun run readme:media --video    # the tour + GIFs only
 * ```
 */

import { chromium } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startCaptureServer } from './readme-media/server';
import { captureShots } from './readme-media/shots';
import { captureVideo } from './readme-media/video';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(REPO_ROOT, 'docs/assets');
const FRAMES = join(tmpdir(), 'kabmo-readme-frames');

const args = new Set(process.argv.slice(2));
const wantShots = args.size === 0 || args.has('--shots');
const wantVideo = args.size === 0 || args.has('--video');

async function main(): Promise<void> {
  mkdirSync(ASSETS, { recursive: true });
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });

  const server = await startCaptureServer(REPO_ROOT);
  const browser = await chromium.launch();
  try {
    if (wantShots) await captureShots(browser, server.baseURL, ASSETS);
    if (wantVideo) await captureVideo(browser, server.baseURL, ASSETS, FRAMES);
  } finally {
    await browser.close();
    await server.stop();
    rmSync(FRAMES, { recursive: true, force: true });
  }
  console.log('done');
}

await main();
