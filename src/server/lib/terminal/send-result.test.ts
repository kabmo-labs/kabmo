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
import { asBinaryFrame, frameAccepted } from '@/server/lib/terminal/send-result';

describe('asBinaryFrame', () => {
  test('a Uint8Array becomes a Buffer VIEW over the same bytes', () => {
    const source = new Uint8Array([0x1b, 0x5b, 0x4d, 0x20, 0x20, 0x20]);
    const frame = asBinaryFrame(source);
    expect(Buffer.isBuffer(frame)).toBe(true);
    expect([...(frame as Buffer)]).toEqual([...source]);
    // Elysia only keeps bytes binary for Buffer; a copy would be correct but
    // would double the cost of every PTY frame, so this pins the view.
    (frame as Buffer)[0] = 0x41;
    expect(source[0]).toBe(0x41);
  });

  test('a string stays text', () => {
    expect(asBinaryFrame('{"t":"ready"}')).toBe('{"t":"ready"}');
  });
});

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
