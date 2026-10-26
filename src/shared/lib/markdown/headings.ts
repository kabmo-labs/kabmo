/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A rendered heading, addressed the way a table of contents addresses it.
 *
 * The outline's markdown rows are read from the SOURCE (a fence-aware line
 * scan), while the preview is a RENDERED document — two different texts of the
 * same page. A click therefore cannot name a line: the preview has no lines.
 * It names the heading itself, and the identity is what both sides agree on.
 *
 * Two fields, because one is not enough and each was a wrong answer first:
 *
 * - **The text is normalized**, not raw. A row reads `Hello **world**` — the
 *   source's own spelling — while the rendered heading's `textContent` is
 *   `Hello world`. Comparing the raw forms matches nothing, and a TOC entry
 *   that scrolls nowhere is the "clicked and nothing happened" bug.
 * - **The occurrence disambiguates duplicates.** A page with two `## Notes`
 *   headings is ordinary; the second row must land on the second heading, which
 *   is what a plain `find` by text cannot do (it always answers the first).
 * - **The index is the ordinal fallback**, for the one case the text cannot
 *   settle: a heading whose inline markup normalizes differently from what the
 *   renderer prints. Landing on the row's own position is a near miss; doing
 *   nothing at all is a dead control.
 */

import type { OutlineSymbol } from '@/shared/lib/code/outline/types';

export interface HeadingRevealTarget {
  /** The heading's text, reduced the way the renderer prints it. */
  text: string;
  /** How many EARLIER heading rows share that text. */
  occurrence: number;
  /** Position among the document's heading rows — the ordinal fallback. */
  index: number;
}

/** The five entities a markdown source can spell that a `textContent` decodes. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Reduce a heading to the text a reader sees.
 *
 * Both inputs pass through this: the row's source spelling (`## Hello **world**`)
 * and the rendered element's `textContent` (`Hello world`). Only the forms the
 * two differ on are handled — inline links, images, code spans, emphasis marks,
 * inline HTML and entities — because anything else is already identical on both
 * sides.
 */
export function normalizeHeadingText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
      if (body.startsWith('#')) {
        const code = body.startsWith('#x') || body.startsWith('#X')
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[body.toLowerCase()] ?? match;
    })
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Which rendered heading a contents row names, as an index into `texts`.
 *
 * One function because two surfaces serve this request (the desktop panel and
 * the phone's sheet) and a second implementation is how one of them lands on the
 * first `Notes` heading forever while the other lands on the second.
 *
 * `texts` are the rendered headings' own `textContent`, so both sides of the
 * comparison have been through {@link normalizeHeadingText}.
 */
export function findHeadingIndex(texts: readonly string[], target: HeadingRevealTarget): number {
  const normalized = texts.map(normalizeHeadingText);
  let seen = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] !== target.text) continue;
    if (seen === target.occurrence) return index;
    seen += 1;
  }
  // The ordinal fallback: a heading whose inline markup normalized differently
  // from the source spelling still gets the reader to the right place. Landing
  // one heading off is a near miss; a click that does nothing is a dead control.
  return target.index >= 0 && target.index < texts.length ? target.index : -1;
}

/**
 * The preview target for the row at `index`, or null when the row is not a
 * heading.
 *
 * `symbols` is the list the panel is DRAWING (already windowed), which is safe:
 * the window is the document's first rows in source order, so every earlier
 * heading the occurrence count needs is present.
 */
export function headingPreviewTarget(
  symbols: readonly OutlineSymbol[],
  index: number,
): HeadingRevealTarget | null {
  const symbol = symbols[index];
  if (!symbol || symbol.kind !== 'heading') return null;
  const headings = symbols.filter((row) => row.kind === 'heading');
  const position = headings.indexOf(symbol);
  if (position < 0) return null;
  const text = normalizeHeadingText(symbol.name);
  const occurrence = headings
    .slice(0, position)
    .filter((row) => normalizeHeadingText(row.name) === text).length;
  return { text, occurrence, index: position };
}
