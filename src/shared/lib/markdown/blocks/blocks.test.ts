/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The block map: what a rendered document says its blocks ARE.
 *
 * The properties here are the ones the review feature rests on, and each was
 * measured before it was written down:
 *
 * - `raw` partitions the source exactly, so accumulating line counts names the
 *   real line of every block (a leading blank line, front-matter, a document
 *   with no trailing newline and one with `$$…$$` were all checked).
 * - The identity is content-derived, so inserting a paragraph above every block
 *   leaves every key untouched, and editing a block's own text is the ONLY thing
 *   that changes one.
 * - The mapped render adds attributes and nothing else: strip them and the HTML
 *   is byte-identical to `renderMarkdown`, including the copy button, the table
 *   scroller and the directive/mermaid placeholders.
 */

import { describe, expect, test } from 'bun:test';

import { renderMarkdown, renderMappedMarkdown } from '@/shared/lib/markdown/marked';
import { blockKeyOf, hashBlockText, normalizeBlockText, quoteOf } from '@/shared/lib/markdown/blocks/anchor';

const stripAttributes = (html: string): string => html.replace(/ data-md-(?:block|start|end)="[^"]*"/g, '');

const CORPUS = [
  '# Heading',
  '',
  'Paragraph with **bold**, `code` and a [link](a.md).',
  '',
  '> quote line',
  '> second',
  '',
  '- one',
  '- two',
  '',
  '```ts',
  'const a = 1;',
  '```',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '---',
  '',
  '$$y = 1$$',
  '',
  'End.',
].join('\n');

describe('the block map', () => {
  test('every top-level block carries its identity and its source lines', () => {
    const { blocks } = renderMappedMarkdown(CORPUS, { allowHtml: true });
    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'blockquote',
      'list',
      'code',
      'table',
      'hr',
      'blockMathDisplay',
      'paragraph',
    ]);
    // The heading is line 1; the paragraph that follows the blank line is line 3.
    expect(blocks[0]).toMatchObject({ lineStart: 1, lineEnd: 1 });
    expect(blocks[1]).toMatchObject({ lineStart: 3, lineEnd: 3 });
    // A fenced block spans its fence and body, and its trailing newline is the
    // separator rather than a line of its own.
    expect(blocks[4]).toMatchObject({ lineStart: 11, lineEnd: 13 });
  });

  test('a block map that misses a rendered block would be a silent hole', () => {
    const { html, blocks } = renderMappedMarkdown(CORPUS, { allowHtml: true });
    // Every block the map names must exist in the DOM, and vice versa. This is
    // the test that fails when a new block kind (or a `marked` rename) slips past
    // `BLOCK_RENDERERS`.
    const rendered = (html.match(/data-md-block=/g) ?? []).length;
    expect(rendered).toBe(blocks.length);
  });

  test('the mapped render changes nothing but the attributes', () => {
    const plain = renderMarkdown(CORPUS, { allowHtml: true });
    const mapped = renderMappedMarkdown(CORPUS, { allowHtml: true });
    expect(stripAttributes(mapped.html)).toBe(plain);
    // The overrides `marked.ts` installs must survive the mapper: it captures the
    // renderer table at registration, so wrapping too early would drop them.
    expect(mapped.html).toContain('code-copy-float');
    expect(mapped.html).toContain('md-table-scroll');
    expect(mapped.html).toContain('math-pending');
  });

  test('the chat path stays byte-identical while the mapper is registered', () => {
    const first = renderMarkdown('# T\n\npara\n');
    const again = renderMarkdown('# T\n\npara\n');
    expect(again).toBe(first);
    expect(first).not.toContain('data-md-block');
  });
});

describe('block identity', () => {
  test('an edit above a block does not change its key; its own text does', () => {
    const before = renderMappedMarkdown('# A\n\nfirst\n\nsecond\n', { allowHtml: true }).blocks;
    const after = renderMappedMarkdown('# A\n\ninserted\n\nfirst\n\nsecond\n', { allowHtml: true }).blocks;
    const keysBefore = new Set(before.map((block) => block.key));
    // Every original block is still matched by its own key, except the one whose
    // position the new paragraph took: its text is the same, so its key is the
    // same too. Insertion is not an edit.
    for (const key of keysBefore) expect(after.some((block) => block.key === key)).toBe(true);

    const edited = renderMappedMarkdown('# A\n\nfirst\n\nsecond changed\n', { allowHtml: true }).blocks;
    const lost = before.filter((block) => !edited.some((next) => next.key === block.key));
    expect(lost.map((block) => block.quote)).toEqual(['second']);
  });

  test('a reflow is not an edit, because whitespace is normalized', () => {
    const one = renderMappedMarkdown('a single line\n', { allowHtml: true }).blocks[0];
    const two = renderMappedMarkdown('a single\nline\n', { allowHtml: true }).blocks[0];
    expect(two.key).toBe(one.key);
  });

  test('two identical blocks are told apart by their ordinal', () => {
    const seen = new Map<string, number>();
    expect(blockKeyOf('paragraph', 'same', seen)).toBe('paragraph:' + hashBlockText('same') + '#1');
    expect(blockKeyOf('paragraph', 'same', seen)).toBe('paragraph:' + hashBlockText('same') + '#2');
    // A different TYPE with the same text is a different block.
    expect(blockKeyOf('heading', 'same', seen).endsWith('#1')).toBe(true);
  });

  test('the quote is one line and bounded', () => {
    expect(normalizeBlockText('  a\n\n  b  ')).toBe('a b');
    const long = quoteOf('x'.repeat(400));
    expect(long.length).toBe(160);
    expect(long.endsWith('…')).toBe(true);
  });
});
