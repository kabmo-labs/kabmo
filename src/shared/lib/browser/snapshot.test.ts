/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The snapshot that seeds the panel.
 *
 * `Page.startScreencast` pushes a frame only when the page PAINTS, so an idle
 * tab sends nothing and the panel waited on "Menunggu frame pertama dari
 * browser…" indefinitely (measured on Chromium 1248 for a static page, and for
 * a page that changed once and went idle — see `frame-pipeline.ts`). The
 * snapshot is the fix, and these pin its two contracts: it is boxed like the
 * screencast, and a live frame that lands first wins.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';

import type { CdpConnection } from '@/shared/lib/browser/cdp';
import type { FrameSeeder } from '@/shared/lib/browser/snapshot';
import { createFrameSeeder } from '@/shared/lib/browser/snapshot';
import type { BrowserViewFrame } from '@/shared/types';

type Reply = unknown | Error;

/** Minimal CDP connection: answers from a table, records what was asked. */
function fakeConnection(replies: Record<string, Reply>) {
  const sent: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = [];
  const conn = {
    send: (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
      sent.push({ method, params, sessionId });
      const reply = replies[method];
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
  return { conn: conn as unknown as CdpConnection, sent };
}

const ATTACHED = { sessionId: 'S1', targetId: 'T1' };

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('createFrameSeeder', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function seeder(conn: CdpConnection, frames: BrowserViewFrame[], attached: typeof ATTACHED | null = ATTACHED): FrameSeeder {
    return createFrameSeeder(conn, () => attached, (frame) => frames.push(frame));
  }

  test('captures the attached page clipped and scaled into the frame box', async () => {
    const { conn, sent } = fakeConnection({
      'Page.getLayoutMetrics': { cssVisualViewport: { clientWidth: 1600, clientHeight: 1000 } },
      'Page.captureScreenshot': { data: 'SNAP' },
    });
    const frames: BrowserViewFrame[] = [];
    seeder(conn, frames).seed();
    await settle();
    const capture = sent.find((entry) => entry.method === 'Page.captureScreenshot');
    expect(capture?.params).toEqual({
      format: 'jpeg',
      quality: 60,
      clip: { x: 0, y: 0, width: 1600, height: 1000, scale: 0.8 },
      captureBeyondViewport: false,
    });
    expect(capture?.sessionId).toBe('S1');
    expect(frames).toEqual([{ data: 'SNAP', mimeType: 'image/jpeg', targetId: 'T1' }]);
  });

  test('captures without a clip when the page will not report a viewport', async () => {
    const { conn, sent } = fakeConnection({ 'Page.captureScreenshot': { data: 'SNAP' } });
    const frames: BrowserViewFrame[] = [];
    seeder(conn, frames).seed();
    await settle();
    const capture = sent.find((entry) => entry.method === 'Page.captureScreenshot');
    expect(capture?.params).toEqual({ format: 'jpeg', quality: 60, captureBeyondViewport: false });
    expect(frames).toHaveLength(1);
  });

  test('a refused capture emits nothing and keeps the previous pixels', async () => {
    const { conn } = fakeConnection({ 'Page.captureScreenshot': new Error('no compositor') });
    const frames: BrowserViewFrame[] = [];
    seeder(conn, frames).seed();
    await settle();
    expect(frames).toEqual([]);
  });

  test('a live frame that landed first wins over the late snapshot', async () => {
    const { conn } = fakeConnection({ 'Page.captureScreenshot': { data: 'SNAP' } });
    const frames: BrowserViewFrame[] = [];
    const target = seeder(conn, frames);
    target.seed();
    // The page painted while the capture was in flight.
    target.invalidate();
    await settle();
    expect(frames).toEqual([]);
  });

  test('nothing is captured while no tab is attached', async () => {
    const { conn, sent } = fakeConnection({ 'Page.captureScreenshot': { data: 'SNAP' } });
    const frames: BrowserViewFrame[] = [];
    seeder(conn, frames, null).seed();
    await settle();
    expect(sent).toEqual([]);
    expect(frames).toEqual([]);
  });
});
