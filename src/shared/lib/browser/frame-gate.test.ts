/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rate gate that replaced `everyNthFrame: 2`.
 *
 * The protocol-level knob had to go (Chromium drops the odd frames of a burst,
 * so a single paint became zero frames — see `frame-params.ts`). What replaced
 * it must not reintroduce that loss from this side: a frame that arrives inside
 * the window is DELAYED, and the last one offered in the window is the one that
 * goes out.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';

import { createFrameGate } from '@/shared/lib/browser/frame-gate';
import type { BrowserViewFrame } from '@/shared/types';

const frame = (data: string): BrowserViewFrame => ({ data, mimeType: 'image/jpeg', targetId: 'T1' });

describe('createFrameGate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('emits the first frame immediately', () => {
    const seen: string[] = [];
    const gate = createFrameGate((incoming) => seen.push(incoming.data), 33);
    gate.push(frame('a'));
    expect(seen).toEqual(['a']);
  });

  test('defers a frame inside the window instead of dropping it', () => {
    const seen: string[] = [];
    const gate = createFrameGate((incoming) => seen.push(incoming.data), 33);
    gate.push(frame('a'));
    jest.advanceTimersByTime(10);
    gate.push(frame('b'));
    expect(seen).toEqual(['a']);
    jest.advanceTimersByTime(30);
    expect(seen).toEqual(['a', 'b']);
  });

  test('a burst collapses to the newest frame of the window', () => {
    const seen: string[] = [];
    const gate = createFrameGate((incoming) => seen.push(incoming.data), 33);
    gate.push(frame('a'));
    jest.advanceTimersByTime(5);
    gate.push(frame('b'));
    gate.push(frame('c'));
    gate.push(frame('d'));
    jest.advanceTimersByTime(40);
    expect(seen).toEqual(['a', 'd']);
  });

  test('a frame that waits does not swallow the next window', () => {
    // The deferred frame resets the clock when it lands, so the following
    // frame is measured against the emission, not against the first push.
    const seen: string[] = [];
    const gate = createFrameGate((incoming) => seen.push(incoming.data), 33);
    gate.push(frame('a'));
    jest.advanceTimersByTime(20);
    gate.push(frame('b'));
    jest.advanceTimersByTime(20);
    expect(seen).toEqual(['a', 'b']);
    gate.push(frame('c'));
    expect(seen).toEqual(['a', 'b']);
    jest.advanceTimersByTime(40);
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  test('reset drops the frame in flight and forgets the clock', () => {
    const seen: string[] = [];
    const gate = createFrameGate((incoming) => seen.push(incoming.data), 33);
    gate.push(frame('stale-tab'));
    jest.advanceTimersByTime(5);
    gate.push(frame('pending'));
    gate.reset();
    jest.advanceTimersByTime(100);
    expect(seen).toEqual(['stale-tab']);
    gate.push(frame('new-tab'));
    expect(seen).toEqual(['stale-tab', 'new-tab']);
  });
});
