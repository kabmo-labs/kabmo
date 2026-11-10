/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The coalescer is a byte-stream transformer, so the assertions are about the
 * stream and not about the queue: the concatenation of the frames a viewer
 * receives must equal the concatenation of the reads, in the same order, and the
 * framing must be bounded.
 *
 * Two failures it must not have, both of which the renderer draws as garbage
 * rather than as an error: dropping a trailing partial frame (a prompt that never
 * appears until the next keypress) and reordering (an escape sequence split
 * across two reads, reassembled after a later one).
 *
 * Time is driven with fake timers: a real `setTimeout` wait would make every run
 * pay the flush delay and would fail as a timeout under load instead of pointing
 * at the ordering rule that broke.
 */

import { afterEach, describe, expect, test, vi } from 'bun:test';
import {
  OUTPUT_FLUSH_BYTES,
  OUTPUT_FLUSH_MS,
  createTerminalOutputQueue,
} from '@/server/lib/terminal/output';

const enc = new TextEncoder();
const dec = new TextDecoder();

afterEach(() => {
  vi.useRealTimers();
});

function collector(): { frames: Uint8Array[]; sink: (frame: Uint8Array) => void; text: () => string } {
  const frames: Uint8Array[] = [];
  return {
    frames,
    sink: (frame) => frames.push(frame),
    text: () => dec.decode(join(frames)),
  };
}

function join(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe('createTerminalOutputQueue', () => {
  test('a burst of reads leaves as one frame, in order, byte for byte', () => {
    vi.useFakeTimers();
    const { frames, sink, text } = collector();
    const queue = createTerminalOutputQueue(sink);

    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}\r\n`);
    for (const line of lines) queue.push(enc.encode(line));
    expect(frames.length).toBe(0);
    vi.advanceTimersByTime(OUTPUT_FLUSH_MS + 1);

    expect(frames.length).toBe(1);
    expect(text()).toBe(lines.join(''));
    queue.dispose();
  });

  test('pending bytes are flushed by the timer, once', () => {
    vi.useFakeTimers();
    const { frames, sink, text } = collector();
    const queue = createTerminalOutputQueue(sink);

    queue.push(enc.encode('hello'));
    expect(frames.length).toBe(0);
    vi.advanceTimersByTime(OUTPUT_FLUSH_MS + 1);
    expect(frames.length).toBe(1);
    expect(text()).toBe('hello');

    // A second tick must not re-send it: the timer is one-shot, not an interval.
    vi.advanceTimersByTime(OUTPUT_FLUSH_MS + 1);
    expect(frames.length).toBe(1);
    queue.dispose();
  });

  test('crossing the size threshold delivers without waiting', () => {
    vi.useFakeTimers();
    const { frames, sink } = collector();
    const queue = createTerminalOutputQueue(sink);

    const half = new Uint8Array(OUTPUT_FLUSH_BYTES / 2).fill(0x41);
    queue.push(half);
    expect(frames.length).toBe(0);
    queue.push(half);
    expect(frames.length).toBe(1);
    expect(frames[0].length).toBe(OUTPUT_FLUSH_BYTES);

    // The timer that the first read armed was cancelled, not left to fire twice.
    vi.advanceTimersByTime(OUTPUT_FLUSH_MS + 1);
    expect(frames.length).toBe(1);
    queue.dispose();
  });

  test('a lone read reaches the sink as the same bytes, not a copy', () => {
    const { frames, sink } = collector();
    const queue = createTerminalOutputQueue(sink);

    const read = enc.encode('one read');
    queue.push(read);
    queue.flush();

    expect(frames[0]).toBe(read);
    queue.dispose();
  });

  test('an escape sequence split across reads survives the frame boundary', () => {
    vi.useFakeTimers();
    const { sink, text } = collector();
    const queue = createTerminalOutputQueue(sink);

    // Exactly what a PTY does to a colour sequence: the split falls inside it.
    queue.push(enc.encode('\x1b[3'));
    queue.push(enc.encode('8;5;196mred'));
    vi.advanceTimersByTime(OUTPUT_FLUSH_MS + 1);
    queue.push(enc.encode('\x1b[0m'));
    queue.flush();

    expect(text()).toBe('\x1b[38;5;196mred\x1b[0m');
    queue.dispose();
  });

  test('an empty read is ignored and arms nothing', () => {
    vi.useFakeTimers();
    const { frames, sink } = collector();
    const queue = createTerminalOutputQueue(sink);

    queue.push(new Uint8Array(0));
    vi.advanceTimersByTime(OUTPUT_FLUSH_MS + 1);
    queue.flush();
    expect(frames.length).toBe(0);
    queue.dispose();
  });

  test('flush with nothing pending sends nothing', () => {
    const { frames, sink } = collector();
    const queue = createTerminalOutputQueue(sink);
    queue.flush();
    expect(frames.length).toBe(0);
    queue.dispose();
  });

  test('dispose drops the pending bytes and the armed timer', () => {
    vi.useFakeTimers();
    const { frames, sink } = collector();
    const queue = createTerminalOutputQueue(sink);

    queue.push(enc.encode('never delivered'));
    queue.dispose();
    vi.advanceTimersByTime(OUTPUT_FLUSH_MS + 1);
    queue.flush();
    expect(frames.length).toBe(0);
  });
});
