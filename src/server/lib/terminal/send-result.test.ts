/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two halves of Bun's `send` contract that used to be read backwards: `-1`
 * is "queued, draining" and `0` is "dropped". Both directions are asserted,
 * because a mapping that answers `true` everywhere is as broken as one that
 * answers `false` everywhere — it just fails on the other side.
 */

import { describe, expect, test } from 'bun:test';
import { frameAccepted } from '@/server/lib/terminal/send-result';

describe('frameAccepted', () => {
  test('bytes queued is a delivery', () => {
    expect(frameAccepted(1)).toBe(true);
    expect(frameAccepted(65_536)).toBe(true);
  });

  test('backpressure is still a delivery', () => {
    // Bun enqueued the frame and promises a `drain`; closing the viewer here
    // killed healthy terminals at the first burst.
    expect(frameAccepted(-1)).toBe(true);
  });

  test('zero is the only drop', () => {
    // Closed socket, or past the 16 MiB backpressure limit: the frame is lost,
    // so the viewer must be dropped and the client must replay.
    expect(frameAccepted(0)).toBe(false);
  });
});
