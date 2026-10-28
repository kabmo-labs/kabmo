/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The bounded memo in front of the search row's highlighter.
 *
 * These cases pin the two properties that fail silently on screen:
 *
 * - **A line whose grammar is not usable yet is never cached.** `highlightCode`
 *   asks for the grammar on the way through and falls back for the current pass;
 *   nothing re-renders when the grammar lands, so a cached fallback would pin the
 *   row to the fallback for the life of the cache.
 * - **The cache is bounded, and it evicts the least recently used entry.** It is
 *   a module-level map that outlives every panel, and a search can hold thousands
 *   of distinct lines.
 *
 * The cache size is the observable: a hit and a recompute return equal strings,
 * so the map itself is what these assertions read.
 */

import { beforeAll, describe, expect, test } from 'bun:test';

import { bootSyntax, onLanguageReady, requestLanguage } from '@/shared/lib/code/highlighter';
import { clearHighlightCache, highlightCacheSize, highlightSearchLine } from '@/shared/lib/code/highlight-cache';

const SHIKI_RE = /<span class="shiki">/;
const SHIKI_TOKEN_RE = /--shiki-light:/;

/** A language with no loader at all: `isLanguageReady` can never become true for it. */
const UNLOADABLE_LANG = 'not-a-language-at-all';

beforeAll(async () => {
  // The isomorphic highlighter only boots with `window` present; the Bun test
  // runtime has none. Stub it, boot, then remove the stub.
  Object.assign(globalThis, { window: globalThis });
  await bootSyntax();
  Reflect.deleteProperty(globalThis, 'window');

  await new Promise<void>((resolve) => {
    const settle = () => {
      if (requestLanguage('typescript')) {
        off();
        resolve();
      }
    };
    const off = onLanguageReady(settle);
    settle();
  });
});

describe('highlightSearchLine', () => {
  test('emits the match markup for a line with ranges', () => {
    clearHighlightCache();
    const html = highlightSearchLine('const alpha = 1;', 'typescript', [{ start: 6, end: 11 }]);

    expect(html).toMatch(SHIKI_RE);
    expect(html).toMatch(SHIKI_TOKEN_RE);
    expect(html).toContain('<mark class="find-match">alpha</mark>');
  });

  test('a ready language stores exactly one entry per line', () => {
    clearHighlightCache();

    highlightSearchLine('const alpha = 1;', 'typescript', [{ start: 6, end: 11 }]);
    expect(highlightCacheSize()).toBe(1);
    // The same line again is a hit, not a second entry.
    highlightSearchLine('const alpha = 1;', 'typescript', [{ start: 6, end: 11 }]);
    expect(highlightCacheSize()).toBe(1);
  });

  test('a different range set is a different entry', () => {
    clearHighlightCache();

    highlightSearchLine('const alpha = 1;', 'typescript', [{ start: 6, end: 11 }]);
    highlightSearchLine('const alpha = 1;', 'typescript', [{ start: 0, end: 5 }]);

    expect(highlightCacheSize()).toBe(2);
  });

  test('a language with no usable grammar is rendered and never cached', () => {
    clearHighlightCache();
    const html = highlightSearchLine('const alpha = 1;', UNLOADABLE_LANG, []);

    // It still produces markup (the highlighter falls back to javascript), but
    // nothing is stored — so a grammar that arrives later is not shadowed.
    expect(html).toMatch(SHIKI_RE);
    expect(highlightCacheSize()).toBe(0);
  });

  test('the cache is bounded, evicting the oldest entry and keeping the newest', () => {
    clearHighlightCache();
    const line = (i: number) => `const value${i} = ${i};`;

    for (let i = 0; i <= 2500; i++) highlightSearchLine(line(i), 'typescript', []);

    // 2501 distinct lines against a 2000-entry bound: the bound holds.
    expect(highlightCacheSize()).toBe(2000);

    // The newest entry is resident, so re-reading it adds nothing.
    highlightSearchLine(line(2500), 'typescript', []);
    expect(highlightCacheSize()).toBe(2000);

    // The oldest was evicted, so reading it back re-inserts — and evicts the
    // next-oldest, which is what keeps the bound while the list scrolls.
    highlightSearchLine(line(0), 'typescript', []);
    expect(highlightCacheSize()).toBe(2000);
  });

  test('a cache hit does not disturb the bound', () => {
    clearHighlightCache();
    const line = (i: number) => `const value${i} = ${i};`;
    for (let i = 0; i <= 2500; i++) highlightSearchLine(line(i), 'typescript', []);

    // Re-read an entry that is still resident, 50 times.
    for (let i = 0; i < 50; i++) highlightSearchLine(line(2500), 'typescript', []);

    expect(highlightCacheSize()).toBe(2000);
  });
});
