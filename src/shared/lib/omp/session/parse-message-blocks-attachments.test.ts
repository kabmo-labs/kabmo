/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two extraction surfaces that turn raw omp content back into timeline
 * attachments after a JSONL reload.
 *
 * `extractUserImageAttachments` walks the user content array and must mirror
 * omp's two ways of shipping a picture: inline base64 (a `data:` preview) or an
 * externalized `blob:sha256:<hash>` reference, which deliberately gets an EMPTY
 * preview — building one from the ref string produced an undecodable data URL.
 * Ids are re-derived from the count of *kept* blocks, so a skipped block does
 * not leave a numbering hole, and the file extension is sanitized from the MIME
 * subtype.
 *
 * `stripInlinedTextAttachments` is the display half of the composer's
 * `Attached file:` envelope: it removes the block only when the header is
 * actually followed by a fenced body, and leaves anything else — prose that
 * merely mentions the header, an unterminated block — byte-for-byte intact.
 * The recovery half lives in inlined-attachments.test.ts; here we pin the
 * asymmetric strip rules and their interaction.
 */

import { describe, expect, test } from 'bun:test';
import {
  extractInlinedTextAttachments,
  extractUserImageAttachments,
  stripInlinedTextAttachments,
} from '@/shared/lib/omp/session/parse-message-blocks';

const HASH = 'a'.repeat(64);

describe('extractUserImageAttachments', () => {
  test('returns nothing for non-array content or arrays with no image block', () => {
    expect(extractUserImageAttachments('a string')).toEqual([]);
    expect(extractUserImageAttachments(undefined)).toEqual([]);
    expect(extractUserImageAttachments([])).toEqual([]);
    expect(extractUserImageAttachments([{ type: 'text', text: 'hi' }, 'junk', null])).toEqual([]);
  });

  test('builds a data-URL preview for inline base64 and names the file by MIME', () => {
    expect(extractUserImageAttachments([{ type: 'image', data: 'QUJD', mimeType: 'image/jpeg' }])).toEqual([
      { id: 'att-1', name: 'attachment-1.jpeg', preview: 'data:image/jpeg;base64,QUJD', type: 'image/jpeg' },
    ]);
  });

  test('a blob ref carries an empty preview plus its blobRef', () => {
    const ref = `blob:sha256:${HASH}`;
    expect(extractUserImageAttachments([{ type: 'image', data: ref, mimeType: 'image/png' }])).toEqual([
      {
        id: 'att-1',
        name: 'attachment-1.png',
        preview: '',
        type: 'image/png',
        blobRef: ref,
      },
    ]);
  });

  test('defaults a missing MIME to image/png and sanitizes the extension', () => {
    expect(extractUserImageAttachments([{ type: 'image', data: 'QUJD' }])[0]).toMatchObject({
      name: 'attachment-1.png',
      type: 'image/png',
    });
    // The subtype is scrubbed of anything but alphanumerics.
    expect(extractUserImageAttachments([{ type: 'image', data: 'x', mimeType: 'image/svg+xml' }])[0]).toMatchObject({
      name: 'attachment-1.svgxml',
      type: 'image/svg+xml',
    });
    // A MIME with no subtype at all falls back to png.
    expect(extractUserImageAttachments([{ type: 'image', data: 'x', mimeType: 'image' }])[0].name).toBe(
      'attachment-1.png',
    );
  });

  test('skips blocks with a missing or non-string payload and keeps numbering dense', () => {
    const result = extractUserImageAttachments([
      { type: 'image', data: 'A', mimeType: 'image/png' },
      { type: 'image', data: 123 },
      { type: 'image' },
      { type: 'image', data: 'B', mimeType: 'image/png' },
    ]);
    expect(result.map((a) => a.id)).toEqual(['att-1', 'att-2']);
    expect(result.map((a) => a.preview)).toEqual(['data:image/png;base64,A', 'data:image/png;base64,B']);
  });

  test('preserves block order across mixed inline and blob images', () => {
    const result = extractUserImageAttachments([
      { type: 'image', data: `blob:sha256:${HASH}`, mimeType: 'image/png' },
      { type: 'text', text: 'between' },
      { type: 'image', data: 'QUJD', mimeType: 'image/gif' },
    ]);
    expect(result.map((a) => a.name)).toEqual(['attachment-1.png', 'attachment-2.gif']);
    expect(result[0].blobRef).toBe(`blob:sha256:${HASH}`);
    expect(result[1].blobRef).toBeUndefined();
  });
});

describe('stripInlinedTextAttachments', () => {
  test('leaves text without a header untouched', () => {
    expect(stripInlinedTextAttachments('plain message')).toBe('plain message');
    expect(stripInlinedTextAttachments('')).toBe('');
  });

  test('strips an appended block and keeps the user text, trimmed', () => {
    const prompt = 'please review\n\nAttached file: a.md\n```markdown\nA\n```';
    expect(stripInlinedTextAttachments(prompt)).toBe('please review');
  });

  test('strips a leading block to the empty string', () => {
    const prompt = 'Attached file: a.md\n```markdown\nA\n```';
    expect(stripInlinedTextAttachments(prompt)).toBe('');
  });

  test('strips everything from the first block onward, later blocks included', () => {
    // The composer appends attachments at the END of the prompt, so the strip
    // cuts at the first header and discards the rest — the second block is not
    // re-examined. Recovery (extract) still finds both.
    const prompt = 'q\n\nAttached file: a.md\n```markdown\nA\n```\n\nAttached file: b.md\n```markdown\nB\n```';
    expect(stripInlinedTextAttachments(prompt)).toBe('q');
    expect(extractInlinedTextAttachments(prompt)).toEqual([
      { name: 'a.md', content: 'A' },
      { name: 'b.md', content: 'B' },
    ]);
  });

  test('does not strip a header that is not followed by a fenced body', () => {
    expect(stripInlinedTextAttachments('I saw an Attached file: note')).toBe('I saw an Attached file: note');
    // Header present but no fence at all.
    expect(stripInlinedTextAttachments('q\n\nAttached file: a.md\njust prose')).toBe('q\n\nAttached file: a.md\njust prose');
    // A header inside a single newline (not a blank-line boundary) is prose.
    expect(stripInlinedTextAttachments('q\nAttached file: a.md\n```\nx\n```')).toBe('q\nAttached file: a.md\n```\nx\n```');
  });

  test('the name line only has to be non-empty — extra words are still a name', () => {
    // `[^\n]+` accepts anything on the header line, so this is treated as a
    // (space-bearing) file name rather than prose.
    expect(stripInlinedTextAttachments('q\n\nAttached file: a.md and more\n```\nx\n```')).toBe('q');
  });
});

describe('strip and recover agree on the same envelope', () => {
  test('what strip removes is what extract recovers', () => {
    const prompt = 'summarize\n\nAttached file: notes.md\n```markdown\nline1\nline2\n```';
    expect(extractInlinedTextAttachments(prompt)).toEqual([{ name: 'notes.md', content: 'line1\nline2' }]);
    expect(stripInlinedTextAttachments(prompt)).toBe('summarize');
  });

  test('a malformed envelope is untouched by both', () => {
    const malformed = 'summarize\n\nAttached file: notes.md\nno fence here';
    expect(stripInlinedTextAttachments(malformed)).toBe(malformed);
    expect(extractInlinedTextAttachments(malformed)).toEqual([]);
  });
});
