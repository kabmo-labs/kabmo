/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Find scanning over one document buffer.
 *
 * The SCAN is CodeMirror's: `RegExpCursor` walks the document and hands back the
 * same ordered match list the surface paints, so the matcher and the editor
 * cannot disagree about where a match is. That replaced a hand-written
 * `RegExp.exec` loop, which had to re-implement the two things a cursor gets
 * right for free — never returning a zero-width match (nothing to highlight,
 * nothing to replace, and stepping past it is what keeps the scan terminating)
 * and starting the next search after the previous match rather than at its own
 * index.
 *
 * Everything around the scan is still Kabmo's, deliberately: the options shape,
 * the cap and the `truncated`/`invalid` distinction are the find widget's
 * contract. Replacement expansion lives in `find-replace.ts`, because a caller
 * that only paints matches should not carry the template grammar.
 *
 * A regex that does not compile is a DIFFERENT answer from "no matches", which
 * is why `invalid` exists: a user typing `(` must be told their pattern is
 * broken, not that the file does not contain it.
 */

import { Text } from '@codemirror/state';
import { RegExpCursor } from '@codemirror/search';

import { lineIndexAt, lineStartOffset, type TextRange } from '@/shared/lib/code/editor/lines';

export { lineIndexAt, lineStartOffset };

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  isRegex: boolean;
  /**
   * Restrict the scan to `[inSelection.start, inSelection.end)`.
   *
   * `false` (the default) scans the whole document. The RANGE is carried beside the
   * flag rather than folded into it, because the widget has to show "in selection" as a
   * toggle whose meaning depends on where the selection was when it was armed — and
   * because a range that the user then moves must not silently change what is searched.
   */
  inSelection: boolean;
}

/** Half-open `[start, end)` offset range in the document. */
export type FindMatch = TextRange;

export interface FindResult {
  matches: FindMatch[];
  /** The document holds more matches than the cap; the list stops at it. */
  truncated: boolean;
  /** A regex query that does not compile — a different answer from "no matches". */
  invalid: boolean;
}

/**
 * Ceiling on collected matches. A one-character query over a large file matches
 * tens of thousands of times and every match is a decoration, so past this the
 * list stops and the widget reports `N+`.
 */
export const MAX_FIND_MATCHES = 5_000;

export const DEFAULT_FIND_OPTIONS: FindOptions = {
  matchCase: false,
  wholeWord: false,
  isRegex: false,
  inSelection: false,
};

/**
 * The flags `RegExpCursor` compiles with, stated once.
 *
 * This is not a preference: the cursor builds its own `RegExp` from the pattern
 * SOURCE with `gm` (plus `u` where the engine has unicode property escapes), and
 * a write path that compiled the same source with different flags would answer
 * differently from the list on screen. Measured before this was aligned:
 *
 * - `^foo` / `foo$` — the cursor's `m` makes the anchor per LINE, so the widget
 *   counted 2 matches on a three-line file while Replace All rewrote only the
 *   first (no `m` = start/end of the whole document).
 * - `\p{L}\d` — matched three times in the scan and zero in the replacement,
 *   because a property escape is only a property escape with `u`; without it
 *   `\p` is a literal `p`, so Replace All and Replace One did nothing at all.
 * - `\-`, `\A` — invalid escapes under `u`, so the scan called the pattern
 *   broken while Replace All still edited the file with the non-unicode reading.
 *
 * So the flags live here, `buildFindRegex` is the only compiler, and the scan,
 * the replace preview and both write paths read it.
 */
const BASE_FLAGS = 'gm' + ('unicode' in RegExp.prototype ? 'u' : '');

/**
 * The pattern a query compiles to, or null when the query is empty or does not
 * compile. A literal query is escaped here rather than at the call site so the
 * match scan and the replacement splice can never disagree about what the
 * pattern was.
 *
 * Whole-word is a `\b`-anchored non-capturing group rather than a bare wrap so
 * an alternation (`foo|bar`) keeps its own precedence.
 */
export function buildFindRegex(query: string, options: FindOptions): RegExp | null {
  if (!query) return null;
  const source = options.isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wrapped = options.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(wrapped, options.matchCase ? BASE_FLAGS : `${BASE_FLAGS}i`);
  } catch {
    return null;
  }
}

/**
 * The last string converted to a `Text`, kept for one call.
 *
 * A cursor needs a `Text`, and `Text.of(text.split('\n'))` builds a rope over
 * the whole file. The find widget asks for matches on every keystroke in its
 * query and on every edit, always for the same document, so keeping the last
 * conversion is the difference between one split per render and one per call.
 */
let lastTextSource: string | null = null;
let lastText: Text | null = null;

function asText(source: string): Text {
  if (lastTextSource === source && lastText) return lastText;
  lastText = Text.of(source.split('\n'));
  lastTextSource = source;
  return lastText;
}

/**
 * Every match of `query` in `text`, in document order.
 *
 * `RegExpCursor` searches LINE by line for a pattern that cannot span one, and
 * falls back to a whole-document cursor when the pattern mentions `\n`, `\r`,
 * `\s`, `\W`, `\D`, `\b`-free character classes or `[^`. Both return document
 * offsets, so the caller never learns which one ran.
 */
export function findMatches(
  text: string,
  query: string,
  options: FindOptions,
  range?: { start: number; end: number } | null,
): FindResult {
  if (!query) return { matches: [], truncated: false, invalid: false };
  const pattern = buildFindRegex(query, options);
  if (!pattern) return { matches: [], truncated: false, invalid: true };

  const matches: FindMatch[] = [];
  let cursor: RegExpCursor;
  try {
    cursor = new RegExpCursor(asText(text), pattern.source, { ignoreCase: !options.matchCase });
  } catch {
    // A pattern `new RegExp` accepts but the cursor's own construction refuses
    // (an unsupported flag combination) is still a broken pattern to the user.
    return { matches: [], truncated: false, invalid: true };
  }

  // The range is applied HERE rather than by slicing the text: the match offsets must
  // stay document offsets, or every caller that selects or replaces by them (the bar,
  // the marks, the write path) would be working in a coordinate system of their own.
  const bounds = options.inSelection && range ? range : null;

  while (matches.length < MAX_FIND_MATCHES && !cursor.next().done) {
    const { from, to } = cursor.value;
    if (from === to) continue;
    if (bounds && (from < bounds.start || to > bounds.end)) continue;
    matches.push({ start: from, end: to });
  }

  return { matches, truncated: matches.length >= MAX_FIND_MATCHES, invalid: false };
}

/**
 * The match to call "current" for a caret/anchor at `offset`: the first one
 * that ends after it, so a caret sitting inside a match still counts as being
 * on that match. Wraps to the first match when the anchor is past the last one,
 * and reports -1 for an empty list.
 */
export function matchIndexAtOrAfter(matches: readonly FindMatch[], offset: number): number {
  if (matches.length === 0) return -1;
  for (let index = 0; index < matches.length; index++) {
    if (matches[index].end > offset) return index;
  }
  return 0;
}

/** Step one match forward (`1`) or back (`-1`), wrapping at either end. */
export function stepMatchIndex(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1;
  if (index < 0) return direction === 1 ? 0 : count - 1;
  return (index + direction + count) % count;
}

