/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The frame pipeline between the CDP reader and the SSE stream: one place that
 * decides WHICH picture the panel gets, and one that decides how often.
 *
 * Both halves exist because a screencast alone cannot be trusted to produce a
 * first frame. Chromium only pushes `Page.screencastFrame` when the page paints,
 * so an idle tab — the normal state of a tab an agent finished with — sends
 * nothing and the panel sits on "Menunggu frame pertama dari browser…" forever.
 * Measured on Chromium 1248: a static page attached to and left alone delivered
 * zero frames at any `everyNthFrame`, while `Page.captureScreenshot` answered in
 * 8–40 ms with the page's real pixels, background tab or not (`snapshot.ts`).
 *
 * So the pipeline is: a snapshot seeds the view while the page has painted
 * nothing for us, a live frame always beats a snapshot that is still in flight,
 * and the rate gate defers — never discards — the newest frame.
 */

import type { CdpConnection } from '@/shared/lib/browser/cdp';
import { FRAME_MIN_INTERVAL_MS } from '@/shared/lib/browser/frame-params';
import { createFrameGate } from '@/shared/lib/browser/frame-gate';
import { createFrameSeeder } from '@/shared/lib/browser/snapshot';
import type { BrowserViewFrame } from '@/shared/types';

export interface FramePipeline {
  /** The attached tab changed: forget the pixels and the clock. */
  reset: () => void;
  /** A `Page.screencastFrame` arrived for the attached tab. */
  pushLive: (frame: BrowserViewFrame) => void;
  /**
   * Take a snapshot unless a picture has already crossed downstream. Safe to
   * call from the poll loop: a capture already in flight is not stacked.
   */
  seed: () => void;
  /** A load settled: the new page counts as unpainted, so seed again. */
  seedAfterLoad: () => void;
}

/** `readAttached` is null while nothing is attached (no snapshot possible). */
export function createFramePipeline(
  conn: CdpConnection,
  readAttached: () => { sessionId: string; targetId: string } | null,
  emit: (frame: BrowserViewFrame) => void,
): FramePipeline {
  // Whether any picture (snapshot or live) has crossed downstream for the
  // attached page. Only the downstream sink sets it, so a frame the rate gate
  // is still holding counts as delivered — it will land within a frame budget.
  let painted = false;
  const deliver = (frame: BrowserViewFrame): void => {
    painted = true;
    emit(frame);
  };
  const gate = createFrameGate(deliver, FRAME_MIN_INTERVAL_MS);
  const seeder = createFrameSeeder(conn, readAttached, deliver);

  return {
    reset: () => {
      painted = false;
      gate.reset();
      seeder.invalidate();
    },
    pushLive: (frame) => {
      // A live frame is newer than any snapshot still in flight: cancel it.
      seeder.invalidate();
      gate.push(frame);
    },
    seed: () => {
      if (painted) return;
      seeder.seed();
    },
    seedAfterLoad: () => {
      painted = false;
      seeder.seed();
    },
  };
}
