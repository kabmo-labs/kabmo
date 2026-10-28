/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { createTerminalHistory, sanitizeReplayChunk, trimUtf8ToBytes } from '@/server/lib/terminal/history';

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
const encode = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));

describe('trimUtf8ToBytes', () => {
  test('keeps a short buffer whole', () => {
    const bytes = encode('hello');
    expect(trimUtf8ToBytes(bytes, 16)).toBe(bytes);
  });

  test('never starts inside a multi-byte character', () => {
    // 'é' is 2 bytes, '😀' is 4 — a naive slice at the boundary would leave
    // continuation bytes at the head and decode the whole tail as U+FFFD.
    const bytes = encode('ab😀cd');
    // 8 bytes cut to 5 lands inside the emoji: step forward past it.
    expect(decode(trimUtf8ToBytes(bytes, 5))).toBe('cd');
    // Cut to 6 lands exactly on its first byte: the emoji is kept whole.
    expect(decode(trimUtf8ToBytes(bytes, 6))).toBe('😀cd');
  });

  test('drops the cut character instead of emitting replacement bytes', () => {
    const bytes = encode('😀');
    const trimmed = trimUtf8ToBytes(bytes, 1);
    expect(decode(trimmed)).toBe('');
  });
});

describe('sanitizeReplayChunk', () => {
  test('keeps ordinary output byte-for-byte', () => {
    const input = encode('\x1b[31mred\x1b[0m plain\r\n');
    const { kept, rest } = sanitizeReplayChunk(input);
    expect(kept).toBe(input);
    expect(rest.length).toBe(0);
  });

  test('drops device-attribute and cursor-position queries', () => {
    const { kept, rest } = sanitizeReplayChunk(encode('a\x1b[c b\x1b[6n c'));
    expect(decode(kept)).toBe('a b c');
    expect(rest.length).toBe(0);
  });

  test('drops color queries in both BEL and ST terminated forms', () => {
    const { kept } = sanitizeReplayChunk(encode('x\x1b]11;?\x07y\x1b]10;?\x1b\\z'));
    expect(decode(kept)).toBe('xyz');
  });

  test('keeps OSC payloads that are not queries', () => {
    // The window-title sequence a shell emits on every prompt is not a query.
    const input = encode('\x1b]7;file://host/tmp\x07');
    expect(sanitizeReplayChunk(input).kept).toBe(input);
  });

  test('drops a query whose bytes straddle two chunks', () => {
    // The split is what makes this stateful: neither chunk alone is a complete
    // query, but their concatenation is one.
    const history = createTerminalHistory();
    history.append(encode('abc\x1b['));
    history.append(encode('c done'));
    expect(decode(history.replay())).toBe('abc done');
  });

  test('does not hold back a sequence it can see is not a query', () => {
    const { kept, rest } = sanitizeReplayChunk(encode('a\x1b[32m'));
    expect(decode(kept)).toBe('a\x1b[32m');
    expect(rest.length).toBe(0);
  });
});

describe('createTerminalHistory', () => {
  test('accumulates appended chunks in order', () => {
    const history = createTerminalHistory();
    history.append(encode('one '));
    history.append(encode('two'));
    expect(decode(history.replay())).toBe('one two');
  });

  test('trims from the front once the cap is exceeded', () => {
    const history = createTerminalHistory(16);
    history.append(encode('aaaaaaaaaa'));
    history.append(encode('bbbbbbbbbb'));
    // Whole chunks are dropped, so the retained size lands just under the cap
    // instead of being re-sliced on every append.
    expect(decode(history.replay())).toBe('bbbbbbbbbb');
  });

  test('trims a single oversized chunk at a UTF-8 boundary', () => {
    const history = createTerminalHistory(5);
    history.append(encode('ab😀cd'));
    // A byte-wise cut at offset 3 would land inside the emoji and decode the
    // rest as U+FFFD; the trim steps forward to the next sequence start.
    expect(decode(history.replay())).toBe('cd');
  });

  test('keeps the newest chunks when several are dropped', () => {
    const history = createTerminalHistory(7);
    history.append(encode('ab'));
    history.append(encode('cd'));
    history.append(encode('ef'));
    history.append(encode('gh'));
    // 8 bytes against a 7-byte cap drops the oldest chunk whole.
    expect(decode(history.replay())).toBe('cdefgh');
  });

  test('clear empties the replay buffer', () => {
    const history = createTerminalHistory();
    history.append(encode('gone'));
    history.clear();
    expect(history.replay().length).toBe(0);
  });
});
