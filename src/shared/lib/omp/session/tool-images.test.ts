/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The pictures a tool result carries, and the URL the timeline paints them
 * from.
 *
 * A `read` of an image answers with `{type:'image', data, mimeType}` beside its
 * text note, and omp externalizes anything large to the blob store — measured
 * on this install, 421 of 435 image blocks in the session files are
 * `blob:sha256:` refs. The timeline used to ignore all of it and reconstruct
 * the picture from the tool call's PATH, which only resolves inside the browse
 * scope: a `read` of `/tmp/shiki96.png` drew a broken image while the bytes sat
 * in the result. These tests pin both the extraction and the URL choice.
 */

import { describe, expect, test } from 'bun:test';
import { blobHashOf, extractToolImages, toolImageSrc } from '@/shared/lib/omp/session/tool-images';

const HASH = 'a'.repeat(64);

describe('extractToolImages', () => {
  test('reads a blob-ref image beside its text note', () => {
    const content = [
      { type: 'text', text: 'Read image file [image/jpeg]\n[Image: original 96x96…]' },
      { type: 'image', data: `blob:sha256:${HASH}`, mimeType: 'image/jpeg' },
    ];
    expect(extractToolImages(content)).toEqual([
      { mimeType: 'image/jpeg', blobRef: `blob:sha256:${HASH}` },
    ]);
  });

  test('reads an inline base64 image', () => {
    expect(extractToolImages([{ type: 'image', data: 'QUJD', mimeType: 'image/png' }])).toEqual([
      { mimeType: 'image/png', dataBase64: 'QUJD' },
    ]);
  });

  test('accepts a message record, not just its content array', () => {
    // Both call sites hold a different shape: the live fold has the whole
    // toolResult message, the reload pass has the same. Neither should have to
    // know which one this wants.
    const message = { role: 'toolResult', content: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }] };
    expect(extractToolImages(message)).toEqual([{ mimeType: 'image/png', dataBase64: 'QUJD' }]);
  });

  test('defaults a missing mimeType rather than dropping the picture', () => {
    expect(extractToolImages([{ type: 'image', data: 'QUJD' }])).toEqual([
      { mimeType: 'image/png', dataBase64: 'QUJD' },
    ]);
  });

  test('ignores text blocks, other block types and malformed data', () => {
    expect(extractToolImages([{ type: 'text', text: 'no picture here' }])).toEqual([]);
    expect(extractToolImages([{ type: 'image' }])).toEqual([]);
    expect(extractToolImages([{ type: 'image', data: '' }])).toEqual([]);
    expect(extractToolImages('not content')).toEqual([]);
    expect(extractToolImages(null)).toEqual([]);
  });

  test('a malformed blob ref falls back to the inline branch', () => {
    // A truncated digest is not a store reference; treating it as base64 keeps
    // the panel from pointing an <img> at a route that will 404.
    const images = extractToolImages([{ type: 'image', data: 'blob:sha256:short', mimeType: 'image/png' }]);
    expect(images).toEqual([{ mimeType: 'image/png', dataBase64: 'blob:sha256:short' }]);
  });
});

describe('toolImageSrc', () => {
  test('a blob ref goes through Kabmo route, not a data URL', () => {
    expect(toolImageSrc({ mimeType: 'image/jpeg', blobRef: `blob:sha256:${HASH}` }))
      .toBe(`/api/omp/blob?hash=${HASH}`);
  });

  test('an inline payload becomes a data URL', () => {
    expect(toolImageSrc({ mimeType: 'image/png', dataBase64: 'QUJD' }))
      .toBe('data:image/png;base64,QUJD');
  });

  test('a reference with no payload has no source', () => {
    expect(toolImageSrc({ mimeType: 'image/png' })).toBeNull();
    expect(toolImageSrc({ mimeType: 'image/png', blobRef: 'blob:sha256:nope' })).toBeNull();
  });
});

describe('blobHashOf', () => {
  test('accepts only a canonical 64-char lowercase digest', () => {
    expect(blobHashOf(`blob:sha256:${HASH}`)).toBe(HASH);
    expect(blobHashOf(`blob:sha256:${'A'.repeat(64)}`)).toBeNull();
    expect(blobHashOf('blob:sha256:abc')).toBeNull();
    expect(blobHashOf('data:image/png;base64,QUJD')).toBeNull();
  });
});
