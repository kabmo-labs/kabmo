/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `truncateTailLines` is the display-only guard that keeps a single tool result
 * from pouring thousands of rows into the DOM. The contract these pin is the
 * pair a caller reads back: `text` is exactly the tail that survives, and
 * `skipped` is the number of leading lines that did not — because callers print
 * "… N earlier lines hidden" from it and slice a parallel gutter by the same
 * count. Getting `skipped` wrong misaligns every row number that follows.
 *
 * Pure function, no mounting: called directly, including the default ceiling.
 */

import { describe, expect, test } from 'bun:test';
import {
  MAX_OUTPUT_LINES,
  truncateTailLines,
} from '@/client/components/workspace/chat-timeline/tool-renderers/shared/truncate';

describe('truncateTailLines', () => {
  test('reports nothing hidden for an empty payload', () => {
    expect(truncateTailLines('')).toEqual({ text: '', skipped: 0 });
  });

  test('returns a payload shorter than the ceiling untouched', () => {
    const text = ['a', 'b', 'c'].join('\n');
    expect(truncateTailLines(text, 5)).toEqual({ text, skipped: 0 });
  });

  test('keeps the tail and counts the leading lines it dropped', () => {
    const text = ['1', '2', '3', '4', '5'].join('\n');
    expect(truncateTailLines(text, 2)).toEqual({ text: '4\n5', skipped: 3 });
  });

  test('treats a payload exactly at the ceiling as nothing to hide', () => {
    const text = ['1', '2', '3'].join('\n');
    expect(truncateTailLines(text, 3)).toEqual({ text, skipped: 0 });
  });

  test('splits CRLF output the same way, so Windows logs align too', () => {
    expect(truncateTailLines('a\r\nb\r\nc\r\nd', 2)).toEqual({ text: 'c\nd', skipped: 2 });
  });

  test('defaults to MAX_OUTPUT_LINES when no ceiling is given', () => {
    const text = Array.from({ length: MAX_OUTPUT_LINES + 1 }, (_, i) => `line ${i}`).join('\n');
    const result = truncateTailLines(text);
    expect(result.skipped).toBe(1);
    expect(result.text.startsWith('line 1\n')).toBe(true);
  });
});
