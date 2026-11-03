/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The frame box shared by the screencast and the seeding snapshot.
 *
 * `Page.captureScreenshot` has no `maxWidth`/`maxHeight`; a clip's `scale` is
 * the only way to make a snapshot land in the same box the screencast
 * downscales to. If the two disagree the first live frame pops, so the box and
 * the scale are pinned here.
 */

import { describe, expect, test } from 'bun:test';

import { FRAME_MAX_HEIGHT, FRAME_MAX_WIDTH, SCREENCAST_PARAMS, frameScale } from '@/shared/lib/browser/frame-params';

describe('frame params', () => {
  test('the screencast asks for every frame', () => {
    // Pinned because `everyNthFrame: 2` was the shipped default and it is what
    // made an idle tab deliver nothing at all (measured, see the module doc).
    expect(SCREENCAST_PARAMS.everyNthFrame).toBe(1);
    expect(SCREENCAST_PARAMS.maxWidth).toBe(FRAME_MAX_WIDTH);
    expect(SCREENCAST_PARAMS.maxHeight).toBe(FRAME_MAX_HEIGHT);
    expect(SCREENCAST_PARAMS.format).toBe('jpeg');
  });

  test('a viewport wider than the box is scaled down by the tighter axis', () => {
    expect(frameScale(1600, 1000)).toBeCloseTo(0.8);
    expect(frameScale(1000, 1600)).toBeCloseTo(0.5);
  });

  test('a viewport inside the box is never upscaled', () => {
    expect(frameScale(640, 400)).toBe(1);
    expect(frameScale(FRAME_MAX_WIDTH, FRAME_MAX_HEIGHT)).toBe(1);
  });

  test('a viewport that reports nothing usable yields no scale', () => {
    expect(frameScale(0, 0)).toBe(1);
    expect(frameScale(Number.NaN, 800)).toBe(1);
  });
});
