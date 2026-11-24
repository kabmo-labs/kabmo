/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two properties the pasted-filename tokens rest on: the text a paste
 * writes is exactly the text the chip is named from, and one draft change moves
 * the tokens without inventing names.
 *
 * The boundary cases are the interesting ones: an insertion at a token's end
 * must NOT extend it (typing after the name is prose), an insertion at its
 * start must shift it whole (typing before the name is also prose), and a
 * deletion that empties the token must report it as gone rather than leaving a
 * zero-width name behind.
 */

import { describe, expect, test } from 'bun:test';
import {
  draftEdit,
  insertAttachmentLabels,
  remapAttachmentLabels,
  type DraftLabel,
} from '@/shared/lib/chat/composer/attachment-labels';

const label = (start: number, end: number): DraftLabel => ({ start, end });
const tracked = (entries: [string, DraftLabel][]) => new Map(entries);

describe('insertAttachmentLabels', () => {
  test('writes the filename at the caret and reports where it landed', () => {
    expect(insertAttachmentLabels('ask about ', { start: 10, end: 10 }, ['notes.md'])).toEqual({
      value: 'ask about notes.md',
      caret: 18,
      labels: [label(10, 18)],
    });
  });

  test('replaces the selection the paste was aimed at', () => {
    expect(insertAttachmentLabels('look at THIS please', { start: 8, end: 12 }, ['a.png'])).toEqual({
      value: 'look at a.png please',
      caret: 13,
      labels: [label(8, 13)],
    });
  });

  test('separates several files with one space and tracks each of them', () => {
    const inserted = insertAttachmentLabels('', { start: 0, end: 0 }, ['a.md', 'b.md']);
    expect(inserted.value).toBe('a.md b.md');
    expect(inserted.caret).toBe(9);
    expect(inserted.labels).toEqual([label(0, 4), label(5, 9)]);
  });

  test('skips a nameless file instead of writing an empty token', () => {
    const inserted = insertAttachmentLabels('hi ', { start: 3, end: 3 }, ['  ', '']);
    expect(inserted).toEqual({ value: 'hi ', caret: 3, labels: [] });
  });

  test('clamps a selection that runs past the draft', () => {
    const inserted = insertAttachmentLabels('ab', { start: 9, end: 12 }, ['x.md']);
    expect(inserted.value).toBe('abx.md');
    expect(inserted.labels).toEqual([label(2, 6)]);
  });
});

describe('draftEdit', () => {
  test('is a pure insertion when the text only grew', () => {
    expect(draftEdit('a.md', 'a.md!')).toEqual({ prefix: 4, previousEnd: 4, inserted: '!' });
  });

  test('is a pure deletion when the text only shrank', () => {
    expect(draftEdit('a.md', 'a.m')).toEqual({ prefix: 3, previousEnd: 4, inserted: '' });
  });

  test('replaces the middle when both ends changed', () => {
    expect(draftEdit('say a.md now', 'say b.md now')).toEqual({ prefix: 4, previousEnd: 5, inserted: 'b' });
  });
});

describe('remapAttachmentLabels', () => {
  const token = tracked([['att', label(4, 8)]]);

  test('keeps a token that a later sentence did not touch', () => {
    expect(remapAttachmentLabels('say a.md', 'say a.md then', token).get('att')).toEqual(label(4, 8));
  });

  test('shifts a token right when text is typed before it', () => {
    expect(remapAttachmentLabels('say a.md', 'oh say a.md', token).get('att')).toEqual(label(7, 11));
  });

  test('renames through text typed INSIDE the token', () => {
    const renamed = remapAttachmentLabels('say a.md ok', 'say a.mxd ok', tracked([['att', label(4, 8)]]));
    expect(renamed.get('att')).toEqual(label(4, 9));
    expect('say a.mxd ok'.slice(4, 9)).toBe('a.mxd');
  });

  test('extends a token typed onto at the very end of the draft', () => {
    expect(remapAttachmentLabels('say a.md', 'say a.mdx', token).get('att')).toEqual(label(4, 9));
  });

  test('extends a token when one unbroken run is typed at its end', () => {
    const grown = remapAttachmentLabels('say a.md', 'say a.mdx', token).get('att');
    expect(grown).toEqual(label(4, 9));
    expect('say a.mdx'.slice(4, 9)).toBe('a.mdx');
  });

  test('does not extend a token when prose is typed at its end', () => {
    const grown = remapAttachmentLabels('say a.md', 'say a.md and', token).get('att');
    expect('say a.md and'.slice(grown!.start, grown!.end)).toBe('a.md');
  });

  test('shifts a token whole when text is typed at its start', () => {
    const shifted = remapAttachmentLabels('say a.md', 'say Xa.md', token).get('att');
    expect('say Xa.md'.slice(shifted!.start, shifted!.end)).toBe('a.md');
  });

  test('reports a token the edit emptied as gone', () => {
    expect(remapAttachmentLabels('say a.md ok', 'say  ok', token).get('att')).toBeNull();
  });

  test('renames through a whole-token replacement', () => {
    expect(remapAttachmentLabels('say a.md', 'say hello', token).get('att')).toEqual(label(4, 9));
  });

  test('reports a token that became prose as gone', () => {
    expect(remapAttachmentLabels('look at notes.md', 'write tests', tracked([['att', label(8, 16)]]))).toEqual(
      new Map([['att', null]]),
    );
  });

  test('keeps two tokens apart when the edit sits between them', () => {
    const pair = tracked([['first', label(0, 4)], ['second', label(9, 13)]]);
    const after = remapAttachmentLabels('a.md and b.md', 'a.md plus b.md', pair);
    expect(after.get('first')).toEqual(label(0, 4));
    expect(after.get('second')).toEqual(label(10, 14));
  });

  test('keeps a pasted name that already contains a space', () => {
    const spaced = tracked([['att', label(4, 15)]]);
    const after = remapAttachmentLabels('see my notes.md', 'see my notes.md now', spaced);
    expect(after.get('att')).toEqual(label(4, 15));
  });

  test('renames the second of two identical filenames without touching the first', () => {
    const twins = tracked([['first', label(0, 4)], ['second', label(5, 9)]]);
    const after = remapAttachmentLabels('a.md a.md', 'a.md b.md', twins);
    expect(after.get('first')).toEqual(label(0, 4));
    expect(after.get('second')).toEqual(label(5, 9));
  });

  test('leaves every token alone when nothing changed', () => {
    const after = remapAttachmentLabels('say a.md', 'say a.md', token);
    expect(after.get('att')).toEqual(label(4, 8));
  });
});
