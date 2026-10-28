/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Pins the terminal wire contract. Every frame here crosses a process boundary:
 * a bogus grid would reach the PTY, an undecoded frame would be dropped, and a
 * mis-encoded id would 404 the socket. These tests lock the clamping bounds,
 * the id grammar, the JSON encode/decode round trips and the null-on-malformed
 * contract both ends rely on, so a refactor cannot silently loosen them.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_INPUT_BYTES,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
  clampTerminalSize,
  decodeClientFrame,
  decodeServerFrame,
  encodeClientFrame,
  encodeServerFrame,
  isValidTerminalId,
  newTerminalId,
  terminalSocketUrl,
} from '@/shared/lib/workspace/terminal/protocol';

describe('clampTerminalSize', () => {
  test('leaves an in-bounds grid untouched', () => {
    expect(clampTerminalSize(80, 24)).toEqual({ cols: 80, rows: 24 });
  });

  test('raises zero and negative dimensions to the minimums', () => {
    expect(clampTerminalSize(0, 0)).toEqual({ cols: TERMINAL_MIN_COLS, rows: TERMINAL_MIN_ROWS });
    expect(clampTerminalSize(-5, -1)).toEqual({ cols: TERMINAL_MIN_COLS, rows: TERMINAL_MIN_ROWS });
  });

  test('caps dimensions above the maximums', () => {
    expect(clampTerminalSize(5000, 5000)).toEqual({ cols: TERMINAL_MAX_COLS, rows: TERMINAL_MAX_ROWS });
  });

  test('treats exact bounds as in-bounds', () => {
    expect(clampTerminalSize(TERMINAL_MIN_COLS, TERMINAL_MIN_ROWS)).toEqual({ cols: 2, rows: 1 });
    expect(clampTerminalSize(TERMINAL_MAX_COLS, TERMINAL_MAX_ROWS)).toEqual({ cols: 1000, rows: 500 });
  });

  test('truncates fractional dimensions toward zero', () => {
    expect(clampTerminalSize(80.9, 24.9)).toEqual({ cols: 80, rows: 24 });
    expect(clampTerminalSize(2.9, 1.9)).toEqual({ cols: 2, rows: 1 });
  });

  test('non-finite dimensions fall back to the minimum, not the maximum', () => {
    expect(clampTerminalSize(Number.NaN, Number.NaN)).toEqual({ cols: TERMINAL_MIN_COLS, rows: TERMINAL_MIN_ROWS });
    expect(clampTerminalSize(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toEqual({
      cols: TERMINAL_MIN_COLS,
      rows: TERMINAL_MIN_ROWS,
    });
    expect(clampTerminalSize(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)).toEqual({
      cols: TERMINAL_MIN_COLS,
      rows: TERMINAL_MIN_ROWS,
    });
  });

  test('exports the documented input frame ceiling', () => {
    expect(TERMINAL_MAX_INPUT_BYTES).toBe(64 * 1024);
  });
});

describe('isValidTerminalId', () => {
  test('accepts the id grammar', () => {
    expect(isValidTerminalId('abc')).toBe(true);
    expect(isValidTerminalId('A-b_9')).toBe(true);
    expect(isValidTerminalId('a'.repeat(64))).toBe(true);
    expect(isValidTerminalId('3f7c1b1e-9a2d-4e0b-8f5a-0c1d2e3f4a5b')).toBe(true);
  });

  test('rejects empty, over-long and out-of-grammar ids', () => {
    expect(isValidTerminalId('')).toBe(false);
    expect(isValidTerminalId('a'.repeat(65))).toBe(false);
    expect(isValidTerminalId('has space')).toBe(false);
    expect(isValidTerminalId('has/slash')).toBe(false);
    expect(isValidTerminalId('has.dot')).toBe(false);
    expect(isValidTerminalId('café')).toBe(false);
  });
});

describe('newTerminalId', () => {
  test('produces ids the validator accepts', () => {
    for (let i = 0; i < 50; i++) {
      const id = newTerminalId();
      expect(id.length).toBeGreaterThan(0);
      expect(isValidTerminalId(id)).toBe(true);
    }
  });

  test('does not repeat across calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newTerminalId()));
    expect(ids.size).toBe(200);
  });
});

describe('encode/decodeClientFrame', () => {
  test('round-trips an attach frame through JSON', () => {
    const frame = { t: 'attach', cols: 120, rows: 40, root: '/tmp/x', repo: 'x', theme: 'dark' } as const;
    expect(decodeClientFrame(encodeClientFrame(frame))).toEqual(frame);
  });

  test('decodes a parsed object as well as raw JSON text', () => {
    expect(decodeClientFrame({ t: 'resize', cols: 80, rows: 24 })).toEqual({ t: 'resize', cols: 80, rows: 24 });
  });

  test('drops unknown optional fields but keeps valid ones', () => {
    const decoded = decodeClientFrame({ t: 'attach', cols: 80, rows: 24, root: 7, repo: 'r', theme: 'blue' });
    expect(decoded).toEqual({ t: 'attach', cols: 80, rows: 24, repo: 'r' });
  });

  test('truncates fractional dimensions in a frame', () => {
    expect(decodeClientFrame({ t: 'resize', cols: 80.9, rows: 24.1 })).toEqual({ t: 'resize', cols: 80, rows: 24 });
  });

  test('returns null when a dimension is missing or not a finite number', () => {
    expect(decodeClientFrame({ t: 'attach', rows: 24 })).toBeNull();
    expect(decodeClientFrame({ t: 'attach', cols: '80', rows: 24 })).toBeNull();
    expect(decodeClientFrame({ t: 'resize', cols: Number.NaN, rows: 24 })).toBeNull();
    expect(decodeClientFrame({ t: 'resize', cols: 80, rows: Number.POSITIVE_INFINITY })).toBeNull();
  });

  test('decodes close and ignores extra fields', () => {
    expect(decodeClientFrame({ t: 'close', cols: 1 })).toEqual({ t: 'close' });
    expect(decodeClientFrame('{"t":"close"}')).toEqual({ t: 'close' });
  });

  test('returns null for unknown types, malformed JSON and non-records', () => {
    expect(decodeClientFrame({ t: 'nope' })).toBeNull();
    expect(decodeClientFrame('not json')).toBeNull();
    expect(decodeClientFrame('{"t":"attach",')).toBeNull();
    expect(decodeClientFrame(null)).toBeNull();
    expect(decodeClientFrame(42)).toBeNull();
    expect(decodeClientFrame([{ t: 'close' }])).toBeNull();
  });
});

describe('decodeServerFrame', () => {
  test('decodes a ready frame and defaults replayBytes to 0', () => {
    const decoded = decodeServerFrame(
      JSON.stringify({ t: 'ready', id: 'abc', cwd: '/tmp', cols: 80, rows: 24, status: 'running' }),
    );
    if (!decoded || decoded.t !== 'ready') throw new Error('expected a ready frame');
    expect(decoded.t).toBe('ready');
    if (decoded?.t === 'ready') expect(decoded).toMatchObject({ id: 'abc', cwd: '/tmp', cols: 80, rows: 24, status: 'running', replayBytes: 0 });
  });

  test('keeps an explicit replayBytes and ignores a non-numeric one', () => {
    const base = { t: 'ready', id: 'abc', cwd: '/tmp' };
    expect(decodeServerFrame(JSON.stringify({ ...base, replayBytes: 4096 }))).toMatchObject({ replayBytes: 4096 });
    expect(decodeServerFrame(JSON.stringify({ ...base, replayBytes: 'x' }))).toMatchObject({ replayBytes: 0 });
  });

  test('rejects a ready frame without string id and cwd', () => {
    expect(decodeServerFrame(JSON.stringify({ t: 'ready', id: 'abc' }))).toBeNull();
    expect(decodeServerFrame(JSON.stringify({ t: 'ready', cwd: '/tmp' }))).toBeNull();
    expect(decodeServerFrame(JSON.stringify({ t: 'ready', id: 1, cwd: '/tmp' }))).toBeNull();
  });

  test('normalizes exit fields to null when absent or mistyped', () => {
    expect(decodeServerFrame(JSON.stringify({ t: 'exit', exitCode: 0, signal: 'SIGTERM' }))).toEqual({
      t: 'exit',
      exitCode: 0,
      signal: 'SIGTERM',
    });
    expect(decodeServerFrame(JSON.stringify({ t: 'exit' }))).toEqual({ t: 'exit', exitCode: null, signal: null });
    expect(decodeServerFrame(JSON.stringify({ t: 'exit', exitCode: '1', signal: 9 }))).toEqual({
      t: 'exit',
      exitCode: null,
      signal: null,
    });
  });

  test('keeps known error codes and maps everything else to unknown', () => {
    expect(decodeServerFrame(JSON.stringify({ t: 'error', code: 'capacity', message: 'full' }))).toEqual({
      t: 'error',
      code: 'capacity',
      message: 'full',
    });
    expect(decodeServerFrame(JSON.stringify({ t: 'error', code: 'bogus', message: 'x' }))).toEqual({
      t: 'error',
      code: 'unknown',
      message: 'x',
    });
    expect(decodeServerFrame(JSON.stringify({ t: 'error', message: 'x' }))).toEqual({
      t: 'error',
      code: 'unknown',
      message: 'x',
    });
  });

  test('rejects an error frame without a string message', () => {
    expect(decodeServerFrame(JSON.stringify({ t: 'error', code: 'spawn' }))).toBeNull();
    expect(decodeServerFrame(JSON.stringify({ t: 'error', code: 'spawn', message: 5 }))).toBeNull();
  });

  test('returns null for unknown types and malformed JSON', () => {
    expect(decodeServerFrame(JSON.stringify({ t: 'nope' }))).toBeNull();
    expect(decodeServerFrame('{')).toBeNull();
    expect(decodeServerFrame('"ready"')).toBeNull();
  });

  test('encodeServerFrame is the inverse of decodeServerFrame', () => {
    const frame = { t: 'exit', exitCode: null, signal: 'SIGHUP' } as const;
    expect(decodeServerFrame(encodeServerFrame(frame))).toEqual(frame);
  });
});

describe('terminalSocketUrl', () => {
  // `window` is a browser global the module reads directly; the tests stub it
  // and restore whatever Bun provided (normally nothing).
  const originalWindow = Reflect.get(globalThis, 'window');

  function stubWindow(protocol: string, host: string): void {
    Reflect.set(globalThis, 'window', { location: { protocol, host } });
  }

  afterEach(() => {
    Reflect.set(globalThis, 'window', originalWindow);
  });

  test('uses wss under https and ws under http', () => {
    stubWindow('https:', 'example.test:8443');
    expect(terminalSocketUrl('abc')).toBe('wss://example.test:8443/api/terminal/abc/ws');
    stubWindow('http:', '10.0.0.2:7777');
    expect(terminalSocketUrl('abc')).toBe('ws://10.0.0.2:7777/api/terminal/abc/ws');
  });

  test('percent-encodes the id into the path segment', () => {
    stubWindow('http:', 'host');
    expect(terminalSocketUrl('a/b')).toBe('ws://host/api/terminal/a%2Fb/ws');
  });
});
