/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The screencast frame painter.
 *
 * The failure this file guards against is a memory one, and it is invisible in
 * the rendered output: the panel used to assign each frame to an `<img>`, and
 * WebKit never releases the decoded image behind a replaced `src` — measured on
 * this machine at ~76 KB of WebContent footprint per frame (148 MB for 1 760
 * frames), against 28 MB for the same frames painted onto a canvas. So what is
 * pinned here is that the frame is DECODED, PAINTED and CLOSED, and that a
 * payload the browser cannot decode leaves the previous frame alone instead of
 * blanking the panel.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { base64ToBytes, drawFrame, frameBlob } from '@/client/lib/browser/frame-canvas';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Blob', 'HTMLCanvasElement'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  delete (globalThis as Record<string, unknown>).createImageBitmap;
});

/** A 2×2 JPEG-shaped payload, as far as these cases care. */
const PAYLOAD = btoa('\xff\xd8\xff\xd9');

interface Painted {
  width: number;
  height: number;
  draws: number;
}

/** A canvas whose 2D context records what was drawn into it. */
function fakeCanvas(painted: Painted): HTMLCanvasElement {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: () => { painted.draws += 1; },
    }),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

let closed = 0;
let bitmapSize = { width: 1280, height: 800 };

beforeEach(() => {
  closed = 0;
  bitmapSize = { width: 1280, height: 800 };
  (globalThis as Record<string, unknown>).createImageBitmap = async () => ({
    width: bitmapSize.width,
    height: bitmapSize.height,
    close: () => { closed += 1; },
  });
});

describe('base64ToBytes', () => {
  test('decodes to the exact bytes', () => {
    expect([...base64ToBytes(btoa('kabmo'))]).toEqual([107, 97, 98, 109, 111]);
  });

  test('an empty payload is empty, not a throw', () => {
    expect(base64ToBytes('').length).toBe(0);
  });
});

describe('frameBlob', () => {
  test('carries the frame mime type, which is what the decoder reads', () => {
    expect(frameBlob(PAYLOAD, 'image/jpeg').type).toBe('image/jpeg');
  });
});

describe('drawFrame', () => {
  test('sizes the canvas to the frame and paints it', async () => {
    const painted: Painted = { width: 0, height: 0, draws: 0 };
    const canvas = fakeCanvas(painted);
    expect(await drawFrame(canvas, PAYLOAD, 'image/jpeg')).toBe(true);
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(800);
    expect(painted.draws).toBe(1);
  });

  test('closes the decoded bitmap, which is the whole point', async () => {
    const canvas = fakeCanvas({ width: 0, height: 0, draws: 0 });
    await drawFrame(canvas, PAYLOAD, 'image/jpeg');
    expect(closed).toBe(1);
  });

  test('a frame of a different size resizes the canvas instead of cropping', async () => {
    const canvas = fakeCanvas({ width: 0, height: 0, draws: 0 });
    await drawFrame(canvas, PAYLOAD, 'image/jpeg');
    bitmapSize = { width: 800, height: 600 };
    await drawFrame(canvas, PAYLOAD, 'image/jpeg');
    expect([canvas.width, canvas.height]).toEqual([800, 600]);
  });

  test('an undecodable payload reports failure rather than throwing', async () => {
    (globalThis as Record<string, unknown>).createImageBitmap = async () => { throw new Error('bad jpeg'); };
    const painted: Painted = { width: 0, height: 0, draws: 0 };
    expect(await drawFrame(fakeCanvas(painted), PAYLOAD, 'image/jpeg')).toBe(false);
    expect(painted.draws).toBe(0);
  });

  test('a browser without createImageBitmap reports failure and paints nothing', async () => {
    delete (globalThis as Record<string, unknown>).createImageBitmap;
    const painted: Painted = { width: 0, height: 0, draws: 0 };
    expect(await drawFrame(fakeCanvas(painted), PAYLOAD, 'image/jpeg')).toBe(false);
    expect(painted.draws).toBe(0);
  });
});
