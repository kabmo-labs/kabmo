/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A bounded memo in front of the syntax highlighter, for BLOCK highlights — the
 * code a tool card draws when it opens.
 *
 * Shiki tokenization is the expensive half of rendering a tool card: profiled on
 * a throttled phone, a `read` expand spent 75% of its long task in
 * `findNextMatchSync`/the grammar engine, and the same card re-expanded in 33 ms
 * once its grammar was warm. Two consequences follow, and this module is the
 * second half of both (the first is `idle.ts`, which moves the work off the tap):
 *
 * 1. A card that is closed and reopened is the same code and the same language,
 *    so its markup is the same string. Tokenizing it again is pure waste, and a
 *    reader paging through a transcript does exactly that repeatedly.
 * 2. `Edit` asked for three highlights per render (old, new, preview) when at
 *    most one of them is ever drawn. Caching per `(language, code)` makes the
 *    duplicates free even before the call sites are gated.
 *
 * The key is a two-level map — language, then the code string itself — rather
 * than one composite string, because the composite would COPY the whole file on
 * every lookup, which is exactly the per-frame allocation this exists to remove.
 * Insertion order is the LRU order.
 *
 * Nothing is cached while the language's grammar has not landed: `highlightCode`
 * answers escaped text in that state, and caching it would pin the plain
 * fallback for the life of the entry (the trap `highlight-cache.ts` documents
 * for search rows). `useSyntaxReady` re-runs the caller when a grammar arrives,
 * which is when the entry finally becomes cacheable.
 */

import { isLanguageReady } from '@/shared/lib/code/highlighter-lazy';
import { highlightCode, highlightLines, type HighlightLinesOptions } from '@/shared/lib/code/syntax-highlight';

/** Per language: a transcript page's worth of distinct blocks. */
const MAX_BLOCKS_PER_LANGUAGE = 24;
/** Across every language, so a long session cannot grow without bound. */
const MAX_CACHED_CHARS = 512 * 1024;

const blocks = new Map<string, Map<string, string>>();
let cachedChars = 0;

function bucket(language: string): Map<string, string> {
  const existing = blocks.get(language);
  if (existing) return existing;
  const created = new Map<string, string>();
  blocks.set(language, created);
  return created;
}

/** Drop the oldest entry of the first language that has one. */
function evictOne(): boolean {
  for (const entries of blocks.values()) {
    const oldest = entries.keys().next();
    if (oldest.done) continue;
    const value = entries.get(oldest.value) ?? '';
    entries.delete(oldest.value);
    cachedChars -= value.length;
    return true;
  }
  return false;
}

function remember(language: string, code: string, html: string): void {
  const entries = bucket(language);
  const previous = entries.get(code);
  if (previous !== undefined) {
    entries.delete(code);
    cachedChars -= previous.length;
  }
  entries.set(code, html);
  cachedChars += html.length;
  while (entries.size > MAX_BLOCKS_PER_LANGUAGE) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    const value = entries.get(oldest.value) ?? '';
    entries.delete(oldest.value);
    cachedChars -= value.length;
  }
  while (cachedChars > MAX_CACHED_CHARS && evictOne()) {
    // Keep dropping until the budget holds or nothing is left to drop.
  }
}

/** The cached markup for `(language, code)`, or `undefined`. */
export function cachedHighlightBlock(code: string, language: string): string | undefined {
  const entries = blocks.get(language);
  if (!entries) return undefined;
  const hit = entries.get(code);
  if (hit === undefined) return undefined;
  // Reading is a use: move it to the most-recently-used end.
  entries.delete(code);
  entries.set(code, hit);
  return hit;
}

/** The cached per-line markup, or `undefined`. */
export function cachedHighlightBlockLines(code: string, language: string): string[] | undefined {
  const hit = cachedHighlightBlock(code, language);
  return hit === undefined ? undefined : hit.split('\n');
}

function cacheable(language: string, options: HighlightLinesOptions): boolean {
  // A find-in-progress needs the match markup, which only the line path emits —
  // and which changes per query, so those results are never shared.
  if (options.marks && options.marks.length > 0) return false;
  return isLanguageReady(language);
}

/** `highlightCode` for one block, memoized per `(language, code)`. */
export function highlightBlock(code: string, language: string, options: HighlightLinesOptions = {}): string {
  if (!code) return '';
  const cached = options.marks?.length ? undefined : cachedHighlightBlock(code, language);
  if (cached !== undefined) return cached;
  const html = highlightCode(code, language, options);
  if (cacheable(language, options)) remember(language, code, html);
  return html;
}

/** `highlightLines` for one block, memoized per `(language, code)`. */
export function highlightBlockLines(
  code: string,
  language: string,
  options: HighlightLinesOptions = {},
): string[] {
  if (!code) return [''];
  const cached = options.marks?.length ? undefined : cachedHighlightBlockLines(code, language);
  if (cached !== undefined) return cached;
  const lines = highlightLines(code, language, options);
  if (cacheable(language, options)) remember(language, code, lines.join('\n'));
  return lines;
}

/** Drop every entry. For tests and for a highlighter restart (grammar reload). */
export function clearHighlightMemo(): void {
  blocks.clear();
  cachedChars = 0;
}

/** How many blocks are held — a hit and a recompute return equal strings, so
 *  the map is the only observable. */
export function highlightMemoSize(): number {
  let total = 0;
  for (const entries of blocks.values()) total += entries.size;
  return total;
}
