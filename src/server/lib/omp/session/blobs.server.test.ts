/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Blob-reference resolution for persisted session images.
 *
 * omp externalizes a large attached image out of the session JSONL: the entry
 * keeps a content-addressed ref (`blob:sha256:<hash>`) and the bytes live in the
 * blob store. Nothing else resolves them, so a reloaded session used to render
 * `data:image/png;base64,blob:sha256:…` — a data URL whose payload is the ref
 * string, which the browser cannot decode.
 *
 * The ref suffix feeds a `path.join` against the blob directory, so the
 * canonical-hash guard is the security boundary and is tested as such.
 *
 * The agent dir is read per call (not at import time), so pointing
 * `PI_CODING_AGENT_DIR` at a temp directory is enough to redirect the store.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getBlobStoreDir, isBlobRef, readBlob, readBlobImage, readBlobRef } from '@/server/lib/omp/session/blobs.server';
import { extractUserImageAttachments, isBlobImageRef } from '@/shared/lib/omp/session/parse-message-blocks';

/** A minimal but structurally valid PNG, so the assertion is about real bytes. */
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const HASH = 'a'.repeat(64);

let agentDir = '';

beforeAll(async () => {
  agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'omp-blob-test-'));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await fsp.mkdir(getBlobStoreDir(), { recursive: true });
  await fsp.writeFile(path.join(getBlobStoreDir(), HASH), PNG_BYTES);
});

afterAll(async () => {
  delete process.env.PI_CODING_AGENT_DIR;
  await fsp.rm(agentDir, { recursive: true, force: true });
});

describe('blob store reads', () => {
  test('reads the bytes a hash points at', async () => {
    expect(await readBlob(HASH)).toEqual(PNG_BYTES);
  });

  test('reads through a blob reference', async () => {
    expect(await readBlobRef(`blob:sha256:${HASH}`)).toEqual(PNG_BYTES);
  });

  test('a missing blob yields null instead of throwing', async () => {
    expect(await readBlob('b'.repeat(64))).toBeNull();
  });

  test('a non-reference string yields null', async () => {
    expect(await readBlobRef('iVBORw0KGgo=')).toBeNull();
  });

  // The hash is interpolated into a path, so anything but a canonical digest
  // must be refused before the filesystem is touched.
  test('rejects refs that would escape the blob directory', async () => {
    for (const bad of ['../../../../etc/passwd', '..%2f..%2fetc%2fpasswd', `${'a'.repeat(63)}/`, 'A'.repeat(64), 'abc', '']) {
      expect(await readBlob(bad)).toBeNull();
      expect(await readBlobRef(`blob:sha256:${bad}`)).toBeNull();
    }
  });

  test('recognises the reference prefix', () => {
    expect(isBlobRef(`blob:sha256:${HASH}`)).toBe(true);
    expect(isBlobRef('data:image/png;base64,AAAA')).toBe(false);
  });
});

describe('image block extraction', () => {
  test('an externalized block carries the ref instead of a fake data URL', () => {
    const ref = `blob:sha256:${HASH}`;
    const [attachment] = extractUserImageAttachments([{ type: 'image', data: ref, mimeType: 'image/png' }]);
    expect(attachment.blobRef).toBe(ref);
    // The bug: `data:image/png;base64,blob:sha256:…` is not decodable.
    expect(attachment.preview).toBe('');
    expect(attachment.preview).not.toContain('base64,blob:');
    expect(attachment.type).toBe('image/png');
  });

  test('an inlined block still becomes a data URL', () => {
    const [attachment] = extractUserImageAttachments([{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }]);
    expect(attachment.preview).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(attachment.blobRef).toBeUndefined();
  });

  test('distinguishes the two payload shapes', () => {
    expect(isBlobImageRef(`blob:sha256:${HASH}`)).toBe(true);
    expect(isBlobImageRef('iVBORw0KGgo=')).toBe(false);
  });
});

describe('readBlobImage', () => {
  /** A store entry with NO extension link beside it — what a pruned store or a
   *  copied session leaves behind, and the case the extension cannot answer. */
  const LONE_HASH = 'c'.repeat(64);
  const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

  beforeAll(async () => {
    await fsp.writeFile(path.join(getBlobStoreDir(), LONE_HASH), JPEG_BYTES);
  });

  test('names the content type from the bytes when no extension link exists', async () => {
    // Measured on this install: a `read` of a 96×96 PNG came back as a JPEG
    // blob, so the bytes are the honest source and the sibling link only the
    // fallback.
    const image = await readBlobImage(LONE_HASH);
    expect(image?.mimeType).toBe('image/jpeg');
    expect(image?.bytes).toEqual(JPEG_BYTES);
  });

  test('a missing blob yields null', async () => {
    expect(await readBlobImage('d'.repeat(64))).toBeNull();
  });

  test('a malformed hash never reaches the filesystem', async () => {
    expect(await readBlobImage('../../etc/passwd')).toBeNull();
    expect(await readBlobImage('not-a-hash')).toBeNull();
  });
});
