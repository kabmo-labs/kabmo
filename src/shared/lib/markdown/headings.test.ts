/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The contents entry a preview row publishes, and the rendered heading it finds.
 *
 * Both halves are pinned here because each fails as a click that does nothing:
 *
 * - **Normalization** is what makes a row's SOURCE spelling match the RENDERED
 *   heading's text. `## Hello **world**` and `Hello world` are the same heading
 *   and two different strings.
 * - **Occurrence** is what makes the SECOND `## Notes` row land on the second
 *   heading. A plain find by text always answers the first, which is a silent
 *   wrong answer rather than a missing one.
 * - **The ordinal fallback** covers a heading whose inline markup normalizes
 *   differently from what the renderer prints — one heading off beats a dead
 *   control, and the case is asserted so the fallback cannot be dropped.
 */

import { describe, expect, test } from 'bun:test';
import {
  findHeadingIndex,
  headingPreviewTarget,
  normalizeHeadingText,
  type HeadingRevealTarget,
} from '@/shared/lib/markdown/headings';
import type { OutlineSymbol } from '@/shared/lib/code/outline/types';

function heading(name: string, line: number, depth = 0): OutlineSymbol {
  return { name, kind: 'heading', line, column: depth + 3, depth };
}

describe('normalizeHeadingText', () => {
  test('reduces inline markup to the text a reader sees', () => {
    expect(normalizeHeadingText('Hello **world**')).toBe('hello world');
    expect(normalizeHeadingText('a `code` span')).toBe('a code span');
    expect(normalizeHeadingText('[Label](page.md)')).toBe('label');
    expect(normalizeHeadingText('![alt](img.png) done')).toBe('alt done');
    expect(normalizeHeadingText('Under_score and ~~struck~~')).toBe('underscore and struck');
    expect(normalizeHeadingText('<b>Bold</b> tag')).toBe('bold tag');
  });

  test('decodes the entities a heading can spell', () => {
    expect(normalizeHeadingText('C&amp;C')).toBe('c&c');
    expect(normalizeHeadingText('1 &lt; 2')).toBe('1 < 2');
    expect(normalizeHeadingText('&#65;&#x42;')).toBe('ab');
    // An entity it does not know is left alone rather than becoming nothing.
    expect(normalizeHeadingText('a &bogus; b')).toBe('a &bogus; b');
  });

  test('collapses whitespace, so an indented heading matches its text', () => {
    expect(normalizeHeadingText('  Spaced   Out  ')).toBe('spaced out');
  });
});

describe('headingPreviewTarget', () => {
  const rows: OutlineSymbol[] = [
    heading('Title', 1),
    { name: 'notAHeading', kind: 'function', line: 4, column: 1, depth: 0 },
    heading('Notes', 6, 1),
    heading('Notes', 9, 1),
  ];

  test('a heading row names its normalized text and its occurrence', () => {
    expect(headingPreviewTarget(rows, 0)).toEqual({ text: 'title', occurrence: 0, index: 0 });
    expect(headingPreviewTarget(rows, 2)).toEqual({ text: 'notes', occurrence: 0, index: 1 });
    // The SECOND `Notes` heading: the occurrence is what tells them apart.
    expect(headingPreviewTarget(rows, 3)).toEqual({ text: 'notes', occurrence: 1, index: 2 });
  });

  test('a row that is not a heading has no preview target', () => {
    expect(headingPreviewTarget(rows, 1)).toBeNull();
    expect(headingPreviewTarget(rows, 99)).toBeNull();
  });
});

describe('findHeadingIndex', () => {
  const target = (over: Partial<HeadingRevealTarget> = {}): HeadingRevealTarget => ({
    text: 'notes',
    occurrence: 0,
    index: 0,
    ...over,
  });

  test('lands on the occurrence the row named, not the first match', () => {
    const texts = ['Title', 'Notes', 'Body', 'Notes'];
    expect(findHeadingIndex(texts, target())).toBe(1);
    expect(findHeadingIndex(texts, target({ occurrence: 1 }))).toBe(3);
  });

  test('compares through normalization on BOTH sides', () => {
    // The rendered text already lost its markup; the target kept the source's
    // spelling only as far as normalization goes.
    expect(findHeadingIndex(['Hello world'], target({ text: 'hello **world**' }))).toBe(0);
  });

  test('falls back to the ordinal when the text matches nothing', () => {
    // Inline markup that normalizes differently from what the renderer printed:
    // a near miss is the fallback, an inert click is not.
    const texts = ['Alpha', 'Beta', 'Gamma'];
    expect(findHeadingIndex(texts, target({ text: 'nowhere', index: 2 }))).toBe(2);
  });

  test('an ordinal past the document is no answer at all', () => {
    expect(findHeadingIndex(['Alpha'], target({ text: 'nowhere', index: 7 }))).toBe(-1);
  });
});
