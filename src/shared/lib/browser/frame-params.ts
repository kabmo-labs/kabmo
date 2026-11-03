/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one description of the picture the browser panel renders.
 *
 * Two code paths ask Chromium for that picture — the live screencast, and the
 * one-off snapshot that seeds the panel when the page has nothing left to
 * paint — and they have to agree on the box and the quality, or the first
 * frame pops when the stream takes over from the snapshot.
 */

export const FRAME_MAX_WIDTH = 1280;
export const FRAME_MAX_HEIGHT = 800;
export const FRAME_QUALITY = 60;

/**
 * What the stream asks the page for.
 *
 * `everyNthFrame` MUST stay 1. Measured on Chromium 1248 (both
 * `chrome-headless-shell` and `--headless=new`), a static page that is
 * attached to and then left alone at `everyNthFrame: 2` delivers ZERO frames
 * for as long as it is watched — and it also drops the FIRST paint of every
 * later burst: a page that changed once and went idle stayed on the previous
 * pixels at 2 and showed the change at 1. Chromium counts the produced frames
 * of a burst and drops the odd ones, so nudging it to 2 turned "one paint" into
 * "no paint", which is exactly the "waiting for the first frame" hang.
 *
 * The frame-rate lever lives downstream instead (`FRAME_MIN_INTERVAL_MS`): it
 * can only DEFER the newest frame, never swallow a lone paint.
 */
export const SCREENCAST_PARAMS = {
  format: 'jpeg',
  quality: FRAME_QUALITY,
  maxWidth: FRAME_MAX_WIDTH,
  maxHeight: FRAME_MAX_HEIGHT,
  everyNthFrame: 1,
} as const;

/**
 * Ceiling on frames handed to the SSE stream (~30 fps). Every frame is a
 * base64 JPEG the client decodes into a fresh RGBA surface (measured in WebKit:
 * ~8 KB of WebContent footprint per painted frame, `client/lib/browser/frame-canvas.ts`),
 * and a 30 fps page produced 30 of them a second while the panel is watched,
 * not sampled. Frames inside the window are held, not discarded.
 */
export const FRAME_MIN_INTERVAL_MS = 33;

/**
 * Scale a viewport into the frame box, never up.
 *
 * `Page.captureScreenshot` has no `maxWidth`; a clip's `scale` is the only way
 * to make the snapshot land in the same box the screencast downscales to.
 */
export function frameScale(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(1, FRAME_MAX_WIDTH / width, FRAME_MAX_HEIGHT / height);
}
