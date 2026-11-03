/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reconciliation and the prompt: what a stored judgement becomes once the
 * document has moved.
 *
 * The behaviours pinned here are the ones a user notices when they are wrong:
 * a mark that follows its block, a mark that says it is outdated instead of
 * disappearing, and composer text that names a block precisely enough for the
 * agent to find it.
 */

import { describe, expect, test } from 'bun:test';

import { reconcileAnnotations, tallyAnnotations } from '@/shared/lib/markdown/review/reconcile';
import { appendReviewBlock, formatReviewBlock } from '@/shared/lib/markdown/review/prompt';
import type { DocumentAnnotation, MdBlock } from '@/shared/lib/markdown/blocks/types';

const block = (key: string, quote = key): MdBlock => ({ key, type: 'paragraph', lineStart: 1, lineEnd: 1, quote });

const annotation = (overrides: Partial<DocumentAnnotation> & { id: string; blockKey: string }): DocumentAnnotation => ({
  scope: 'root\u0000.',
  path: 'NOTES.md',
  lineStart: 1,
  lineEnd: 1,
  verdict: 'good',
  note: '',
  quote: 'x',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('reconcileAnnotations', () => {
  test('a mark follows its block, and a mark whose block is gone is OUTDATED', () => {
    const blocks = [block('a'), block('b')];
    const result = reconcileAnnotations(blocks, [
      annotation({ id: '1', blockKey: 'b' }),
      annotation({ id: '2', blockKey: 'gone', updatedAt: 5 }),
    ]);
    expect([...result.attached.keys()]).toEqual(['b']);
    expect(result.outdated.map((row) => row.id)).toEqual(['2']);
    // The note is still there: it is the user's only copy.
    expect(result.outdated[0].quote).toBe('x');
  });

  test('outdated marks are newest first, so the last edit is at the top', () => {
    const result = reconcileAnnotations([], [
      annotation({ id: 'old', blockKey: 'x', updatedAt: 1 }),
      annotation({ id: 'new', blockKey: 'y', updatedAt: 9 }),
    ]);
    expect(result.outdated.map((row) => row.id)).toEqual(['new', 'old']);
  });

  test('the tally counts what is attached, not what is stored', () => {
    const result = reconcileAnnotations([block('a'), block('b')], [
      annotation({ id: '1', blockKey: 'a', verdict: 'good' }),
      annotation({ id: '2', blockKey: 'b', verdict: 'needs-work' }),
      annotation({ id: '3', blockKey: 'outdated', verdict: 'needs-work' }),
    ]);
    expect(tallyAnnotations(result.attached)).toEqual({ good: 1, needsWork: 1 });
  });
});

describe('formatReviewBlock', () => {
  test('names each block by range and quote, and says what the verdict means', () => {
    const text = formatReviewBlock({
      path: 'docs/NOTES.md',
      annotations: [
        annotation({ id: '1', blockKey: 'a', lineStart: 3, lineEnd: 5, verdict: 'needs-work', note: 'basi', quote: '## Notes' }),
        annotation({ id: '2', blockKey: 'b', lineStart: 9, lineEnd: 9, verdict: 'good', quote: 'Run gates' }),
      ],
    });
    expect(text).toContain('[Review dokumen] docs/NOTES.md');
    expect(text).toContain('- L3-5 «## Notes» — needs work: basi');
    expect(text).toContain('- L9 «Run gates» — good');
    // The instruction is what turns a list of verdicts into a decision.
    expect(text).toContain('jangan diubah');
  });

  test('an empty review produces no text at all', () => {
    expect(formatReviewBlock({ path: 'a.md', annotations: [] })).toBe('');
  });

  test('a blank draft takes the block; an existing one is separated by a blank line', () => {
    expect(appendReviewBlock('', 'BLOCK')).toBe('BLOCK');
    expect(appendReviewBlock('draft', 'BLOCK')).toBe('draft\n\nBLOCK');
    // One blank line either way: a single trailing newline still needs a separator.
    expect(appendReviewBlock('draft\n', 'BLOCK')).toBe('draft\n\nBLOCK');
    expect(appendReviewBlock('draft\n\n', 'BLOCK')).toBe('draft\n\nBLOCK');
    expect(appendReviewBlock('draft', '')).toBe('draft');
  });
});
