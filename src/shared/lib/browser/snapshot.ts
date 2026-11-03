/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one-off snapshot that seeds the panel before the screencast can paint.
 *
 * `Page.startScreencast` only pushes frames when the page PRODUCES a new one.
 * A tab the agent finished with is static, and Chromium measures a burst: a
 * page that is attached to and left alone delivers **zero** `Page.screencastFrame`
 * events no matter which `everyNthFrame` is asked for (Chromium 1248, both
 * `chrome-headless-shell` and `--headless=new`; a page that changed once and
 * went idle likewise stayed on the previous pixels at `everyNthFrame: 2`).
 * So the panel sat on "Menunggu frame pertama dari browser…" for a live tab
 * that simply had nothing to redraw.
 *
 * `Page.captureScreenshot` is unaffected: measured on the same build it
 * answers for a BACKGROUND tab (a neighbouring page focused, so the surface is
 * no longer composited on screen), for a just-navigated tab, and in 8–40 ms.
 * Decoded with ffmpeg, the pixels are the page's own — yellow `#ffff00` for a
 * background tab painted yellow, magenta after it navigated to magenta — not a
 * blank surface. This module is that call, boxed to the screencast's size so
 * the snapshot and the first live frame line up instead of popping.
 */

import type { CdpConnection } from '@/shared/lib/browser/cdp';
import { FRAME_QUALITY, frameScale } from '@/shared/lib/browser/frame-params';
import { readNumber, readString } from '@/shared/lib/browser/util';
import { isRecord } from '@/shared/lib/util/guards';
import type { BrowserViewFrame } from '@/shared/types';

/** CSS viewport size of the attached page, or null when the page will not say. */
async function readViewport(conn: CdpConnection, sessionId: string): Promise<{ width: number; height: number } | null> {
  const metrics = await conn.send('Page.getLayoutMetrics', {}, sessionId).catch(() => null);
  if (!isRecord(metrics)) return null;
  const viewport = isRecord(metrics.cssVisualViewport) ? metrics.cssVisualViewport : metrics;
  const width = readNumber(viewport, 'clientWidth');
  const height = readNumber(viewport, 'clientHeight');
  if (!width || !height) return null;
  return { width, height };
}

/**
 * Capture one JPEG of the attached page, scaled into the frame box.
 *
 * Best-effort by contract: a page that refuses (crash, no compositor) yields
 * null and the caller falls back to waiting for a live frame. The clip is the
 * whole viewport at `frameScale`, which is the only knob that makes a snapshot
 * honour `maxWidth`/`maxHeight` — `captureScreenshot` has no such parameter.
 */
export async function captureFrame(
  conn: CdpConnection,
  sessionId: string,
  targetId: string,
): Promise<BrowserViewFrame | null> {
  const viewport = await readViewport(conn, sessionId);
  const clip = viewport
    ? { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: frameScale(viewport.width, viewport.height) }
    : undefined;
  const captured = await conn
    .send('Page.captureScreenshot', { format: 'jpeg', quality: FRAME_QUALITY, ...(clip ? { clip } : {}), captureBeyondViewport: false }, sessionId)
    .catch(() => null);
  const data = isRecord(captured) ? readString(captured, 'data') : undefined;
  if (!data) return null;
  return { data, mimeType: 'image/jpeg', targetId };
}

export interface FrameSeeder {
  /** Snapshot the attached page now; a live frame landing first wins. */
  seed: () => void;
  /** A live frame arrived (or the tab changed): drop any snapshot in flight. */
  invalidate: () => void;
}

/**
 * Snapshot scheduling for one viewer.
 *
 * `seed()` is what removes the "waiting for the first frame" hang: it is called
 * on attach and after a load, the two moments the page will not push a frame
 * of its own. A snapshot that was overtaken by a live frame is DISCARDED —
 * those pixels are newer, and repainting them would show the older page.
 */
export function createFrameSeeder(
  conn: CdpConnection,
  readAttached: () => { sessionId: string; targetId: string } | null,
  emit: (frame: BrowserViewFrame) => void,
): FrameSeeder {
  let generation = 0;
  let inFlight = false;
  return {
    seed: () => {
      const attached = readAttached();
      // A retry loop (the viewer asks again each tick until a picture lands)
      // must not stack captures: one is in flight, the next one starts after.
      if (!attached || inFlight) return;
      generation += 1;
      const mine = generation;
      inFlight = true;
      void captureFrame(conn, attached.sessionId, attached.targetId)
        .then((frame) => {
          if (frame && mine === generation) emit(frame);
        })
        .finally(() => {
          inFlight = false;
        });
    },
    invalidate: () => {
      generation += 1;
    },
  };
}
