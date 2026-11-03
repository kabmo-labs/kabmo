/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The frame pipeline between the CDP reader and the SSE stream: one place that
 * decides WHICH picture the panel gets, and one that decides how often.
 *
 * A screencast alone cannot be trusted to produce a first frame. Chromium only
 * pushes `Page.screencastFrame` when the page paints, so an idle tab — the
 * normal state of a tab an agent finished with — sends nothing. Measured on
 * Chromium 1248: a static page attached to and left alone delivered zero frames
 * at any `everyNthFrame`, while `Page.captureScreenshot` answered in 8–40 ms
 * with the page's real pixels, background tab or not (`snapshot.ts`).
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';

import type { CdpConnection } from '@/shared/lib/browser/cdp';
import type { FramePipeline } from '@/shared/lib/browser/frame-pipeline';
import { createFramePipeline } from '@/shared/lib/browser/frame-pipeline';
import type { BrowserViewFrame } from '@/shared/types';

const frame = (data: string): BrowserViewFrame => ({ data, mimeType: 'image/jpeg', targetId: 'T1' });

function fakeConnection(capture = 'SNAP') {
  const sent: string[] = [];
  const conn = {
    send: (method: string) => {
      sent.push(method);
      if (method === 'Page.captureScreenshot') return Promise.resolve({ data: capture });
      if (method === 'Page.getLayoutMetrics') return Promise.resolve({ cssVisualViewport: { clientWidth: 800, clientHeight: 600 } });
      return Promise.resolve({});
    },
  };
  return { conn: conn as unknown as CdpConnection, sent };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('createFramePipeline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function pipeline(frames: BrowserViewFrame[], attached = true): FramePipeline {
    const { conn } = fakeConnection();
    return createFramePipeline(conn, () => (attached ? { sessionId: 'S1', targetId: 'T1' } : null), (f) => frames.push(f));
  }

  test('seeds the view so a static tab is not stuck waiting', async () => {
    const frames: BrowserViewFrame[] = [];
    pipeline(frames).seed();
    await settle();
    expect(frames.map((f) => f.data)).toEqual(['SNAP']);
  });

  test('a repeated seed from the poll loop does not restack captures', async () => {
    const frames: BrowserViewFrame[] = [];
    const target = pipeline(frames);
    target.seed();
    target.seed();
    target.seed();
    await settle();
    expect(frames.map((f) => f.data)).toEqual(['SNAP']);
  });

  test('stops seeding once a picture has crossed downstream', async () => {
    const frames: BrowserViewFrame[] = [];
    const target = pipeline(frames);
    target.seed();
    await settle();
    target.seed();
    await settle();
    expect(frames.map((f) => f.data)).toEqual(['SNAP']);
  });

  test('does not re-capture after a live frame covered the page', async () => {
    const frames: BrowserViewFrame[] = [];
    const target = pipeline(frames);
    target.pushLive(frame('LIVE'));
    target.seed();
    await settle();
    expect(frames.map((f) => f.data)).toEqual(['LIVE']);
  });

  test('a live frame cancels a snapshot already in flight', async () => {
    const frames: BrowserViewFrame[] = [];
    const target = pipeline(frames);
    target.seed();
    target.pushLive(frame('LIVE'));
    await settle();
    expect(frames.map((f) => f.data)).toEqual(['LIVE']);
  });

  test('a load seeds again, because the new page may paint nothing more', async () => {
    const frames: BrowserViewFrame[] = [];
    const target = pipeline(frames);
    target.pushLive(frame('OLD-PAGE'));
    jest.advanceTimersByTime(50);
    target.seedAfterLoad();
    await settle();
    expect(frames.map((f) => f.data)).toEqual(['OLD-PAGE', 'SNAP']);
  });

  test('reset forgets the tab so the next one seeds immediately', async () => {
    const frames: BrowserViewFrame[] = [];
    const target = pipeline(frames);
    target.pushLive(frame('FIRST-TAB'));
    target.reset();
    jest.advanceTimersByTime(5);
    target.seed();
    await settle();
    expect(frames.map((f) => f.data)).toEqual(['FIRST-TAB', 'SNAP']);
  });

  test('nothing is captured while no tab is attached', async () => {
    const frames: BrowserViewFrame[] = [];
    const target = pipeline(frames, false);
    target.seed();
    await settle();
    expect(frames).toEqual([]);
  });
});
