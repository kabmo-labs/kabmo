/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pure half of the log buffer: the ring's tail read, and the ANSI strip a
 * log is rendered through.
 *
 * Split from `runner.test.ts` when that file carried a third subject and crossed
 * the ceiling. These cases need no process, so they are also the fast ones.
 */

import { describe, expect, test } from 'bun:test';

import { ringText, stripAnsi } from './ring';

describe('ringText', () => {
  test('returns the last N bytes of the ring', () => {
    expect(ringText({ chunks: [Buffer.from('abcdefghij')], held: 10 }, 4)).toBe('ghij');
  });

  test('returns everything when the tail is larger than the buffer', () => {
    expect(ringText({ chunks: [Buffer.from('abc')], held: 3 }, 1024)).toBe('abc');
  });
});

describe('stripAnsi', () => {
  test('removes colour and cursor sequences', () => {
    // What a coloured build actually emits, including a 256-colour code.
    expect(stripAnsi('\u001b[0m\u001b[2;38;5;11m$\u001b[0m make build')).toBe('$ make build');
  });

  test('removes an OSC sequence terminated by BEL', () => {
    expect(stripAnsi('\u001b]0;title\u0007plain')).toBe('plain');
  });

  test('leaves ordinary text alone', () => {
    expect(stripAnsi('12 pass · 0 fail')).toBe('12 pass · 0 fail');
  });
});
