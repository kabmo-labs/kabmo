/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A bounded memo in front of the syntax highlighter, for the one caller that
 * runs it per VISIBLE row rather than per document: the search results list.
 *
 * Shiki tokenization is the expensive half of rendering a search hit — measured
 * at 0.209 ms for a short line and 7.2 ms for a long one, and a scroll of the
 * result list re-ran it for every mounted row. Rows are memoized, but a
 * virtualized list unmounts them as they leave the viewport, so scrolling back
 * would tokenize the same line again without this.
 *
 * The key is the exact triple the output depends on — the line, the language
 * and the match ranges — so a hit that moves under a new query misses rather
 * than painting the previous query's highlight.
 *
 * The bound is entry COUNT, not bytes: a row's markup is proportional to its
 * line, and the lines here are single file lines, so 2000 entries is a few
 * hundred KB in the worst case and keeps a full viewport's worth (plus the
 * scroll-back history around it) resident.
 */

import { isLanguageReady } from '@/shared/lib/code/highlighter-lazy';
import { highlightCode } from '@/shared/lib/code/syntax-highlight';

const MAX_ENTRIES = 2000;

/** Insertion-ordered, so the first key is the least recently used. */
const cache = new Map<string, string>();

/** `1-4,9-12` for the ranges, in document order. */
function rangesKey(ranges: readonly { start: number; end: number }[]): string {
  if (ranges.length === 0) return '';
  let key = '';
  for (const range of ranges) key += `${range.start}-${range.end},`;
  return key;
}

/**
 * `highlightCode` with the match markup, memoized per line.
 *
 * Returns the same string for the same inputs, so a caller may pass the result
 * straight to `dangerouslySetInnerHTML` — the markup is produced by the
 * highlighter, which escapes the file's own text on the way in.
 *
 * A line whose grammar has not arrived yet is rendered as escaped plain text
 * and deliberately NOT cached: `highlightCode` asks for the grammar on the way
 * through, and caching the fallback would pin that line to plain text for the
 * life of the cache — no component re-renders on a grammar arrival, so nothing
 * would ever repaint it. The unhighlighted pass is the cheap one, so recomputing
 * it costs a string scan.
 */
export function highlightSearchLine(
  content: string,
  language: string,
  ranges: readonly { start: number; end: number }[],
): string {
  const cacheable = isLanguageReady(language);
  const key = `${language}\u0000${rangesKey(ranges)}\u0000${content}`;
  if (cacheable) {
    const hit = cache.get(key);
    if (hit !== undefined) {
      // Refresh recency: re-insert so it moves to the tail.
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
  }

  const html = highlightCode(content, language, { marks: ranges });
  if (!cacheable) return html;
  cache.set(key, html);
  if (cache.size > MAX_ENTRIES) {
    // One eviction per insert keeps the map at the bound without a sweep; the
    // first key is the least recently used by construction.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return html;
}

/** Drop every entry. For tests and for a highlighter restart (grammar reload). */
export function clearHighlightCache(): void {
  cache.clear();
}

/**
 * How many lines the cache holds.
 *
 * Exposed because a memo has no other observable: a hit and a recompute return
 * equal strings, so the only way to pin the bound — and the deliberate
 * non-caching of a line whose grammar is not ready — is to look at the map.
 */
export function highlightCacheSize(): number {
  return cache.size;
}
