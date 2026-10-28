/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The block memo in front of the tokenizer.
 *
 * Three properties matter and each was a decision:
 *
 * 1. **A repeat of the same `(language, code)` returns the same markup** — that
 *    is the whole point (a card closed and reopened re-tokenized a 1000-line
 *    read, measured as the dominant cost of its expand).
 * 2. **A block whose grammar is not ready is NOT cached.** `highlightCode`
 *    answers escaped text in that state, and caching it would pin the plain
 *    fallback for the life of the entry.
 * 3. **A find-in-progress bypasses the memo**, because its markup depends on the
 *    match ranges rather than on the code alone.
 */

import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { bootSyntax, onLanguageReady, requestLanguage } from '@/shared/lib/code/highlighter';
import {
  clearHighlightMemo,
  highlightBlock,
  highlightBlockLines,
  highlightMemoSize,
} from '@/shared/lib/code/highlight-memo';

const TOKEN = '--shiki-light:';

beforeAll(async () => {
  Object.assign(globalThis, { window: globalThis });
  await bootSyntax();
  Reflect.deleteProperty(globalThis, 'window');
  const { promise, resolve } = Promise.withResolvers<void>();
  const settle = () => {
    if (requestLanguage('json') && requestLanguage('typescript')) {
      off();
      resolve();
    }
  };
  const off = onLanguageReady(settle);
  settle();
  await promise;
});

beforeEach(() => clearHighlightMemo());

describe('highlightBlock', () => {
  test('a repeated block returns the same markup and is held once', () => {
    const code = 'const value = 1;\n';
    const first = highlightBlock(code, 'typescript');
    const second = highlightBlock(code, 'typescript');

    expect(first).toBe(second);
    expect(first).toContain(TOKEN);
    expect(highlightMemoSize()).toBe(1);
  });

  test('the same code in another language is a different entry', () => {
    highlightBlock('{"a":1}', 'json');
    highlightBlock('{"a":1}', 'typescript');
    expect(highlightMemoSize()).toBe(2);
  });

  test('a grammar that is not ready is never cached', () => {
    const html = highlightBlock('const a = 1;', 'not-a-real-grammar');
    // It still renders something — escaped text, via the javascript fallback —
    // but caching that would freeze the fallback for good.
    expect(html).toContain('const');
    expect(highlightMemoSize()).toBe(0);
  });

  test('a find-in-progress bypasses the memo', () => {
    highlightBlock('const a = 1;', 'typescript', { marks: [{ start: 0, end: 5 }] });
    expect(highlightMemoSize()).toBe(0);
  });

  test('empty input is not an entry', () => {
    expect(highlightBlock('', 'typescript')).toBe('');
    expect(highlightMemoSize()).toBe(0);
  });

  test('the per-language bound holds', () => {
    for (let index = 0; index < 30; index += 1) {
      highlightBlock(`const value${index} = ${index};`, 'typescript');
    }
    expect(highlightMemoSize()).toBeLessThanOrEqual(24);
  });
});

describe('highlightBlockLines', () => {
  test('lines are cached and round-trip through the same key', () => {
    const lines = highlightBlockLines('const a = 1;\nconst b = 2;', 'typescript');
    expect(lines).toHaveLength(2);
    expect(highlightMemoSize()).toBe(1);

    const again = highlightBlockLines('const a = 1;\nconst b = 2;', 'typescript');
    expect(again).toEqual(lines);
  });
});
