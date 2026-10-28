/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { detectLineEnding, toDiskText, toLf } from '@/shared/lib/code/line-endings';

describe('line endings', () => {
  test('the first terminator decides the style', () => {
    expect(detectLineEnding('a\r\nb\n')).toBe('crlf');
    expect(detectLineEnding('a\nb\r\n')).toBe('lf');
  });

  test('a file with no terminator, or one using lone CR, reads as lf', () => {
    expect(detectLineEnding('single line')).toBe('lf');
    expect(detectLineEnding('\rleading')).toBe('lf');
    expect(detectLineEnding('a\rb\r')).toBe('lf');
  });

  test('the buffer form carries no CR', () => {
    expect(toLf('a\r\nb\r\n')).toBe('a\nb\n');
    expect(toLf('a\rb\r')).toBe('a\nb\n');
    expect(toLf('a\nb\n')).toBe('a\nb\n');
  });

  test('writing back restores the detected ending', () => {
    expect(toDiskText('a\nb\n', 'crlf')).toBe('a\r\nb\r\n');
    expect(toDiskText('a\nb\n', 'lf')).toBe('a\nb\n');
    // A mixed buffer still normalizes before it is re-encoded.
    expect(toDiskText('a\r\nb\n', 'crlf')).toBe('a\r\nb\r\n');
  });

  test('an unedited CRLF round trip is byte-identical', () => {
    const disk = 'const a = 1;\r\nconst b = 2;\r\n';
    expect(toDiskText(toLf(disk), detectLineEnding(disk))).toBe(disk);
  });
});
