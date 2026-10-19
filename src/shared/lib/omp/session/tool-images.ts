/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The pictures a tool result carries, and how the timeline points an `<img>`
 * at one.
 *
 * omp answers a `read` of an image with the picture itself: the toolResult's
 * content array holds `{type:'image', data, mimeType}` beside its text note
 * ("Read image file [image/jpeg]"), and the bytes are externalized to the blob
 * store (`blob:sha256:<hash>`) whenever they are large enough — measured on
 * this install, 421 of 435 image blocks in the session files are refs.
 *
 * The timeline used to reconstruct that picture from the tool call's PATH
 * instead, pointing `/api/fs/raw?path=<target>` at it. That route only serves
 * paths inside the browse scope, and `read` routinely names one outside it
 * (`/tmp/shiki96.png`), so the panel drew a broken image for a result whose
 * bytes were sitting in the transcript the whole time. The path is therefore
 * the FALLBACK, for a call whose result recorded no image at all — a text-only
 * answer from a provider without vision, or a session written before this.
 */

import type { ToolImageRef } from '@/shared/types/chat';
import { isRecord } from '@/shared/lib/util/guards';

/** One image a tool result returned. The shape lives in the domain types
 *  (`@/shared/types`) because `ToolCallData` carries it; re-exported here so
 *  the extractor and its callers import one module. */
export type { ToolImageRef };

const BLOB_REF_PREFIX = 'blob:sha256:';

/** Canonical blob digest shape; mirrors the server's own guard. */
const BLOB_HASH_RE = /^[a-f0-9]{64}$/;

/** The digest of a `blob:sha256:<hash>` reference, or null when malformed. */
export function blobHashOf(ref: string): string | null {
  if (!ref.startsWith(BLOB_REF_PREFIX)) return null;
  const hash = ref.slice(BLOB_REF_PREFIX.length);
  return BLOB_HASH_RE.test(hash) ? hash : null;
}

/**
 * Extract every image block from a tool result's content. Text blocks are
 * ignored — they carry the human note, which the panel still shows beside the
 * picture.
 *
 * Accepts either the content array itself (an omp `toolResult` message, an
 * assistant entry's inline blocks) or a single block carrying a `content`
 * array, so a caller can hand over the record it holds without knowing which
 * shape it got.
 */
export function extractToolImages(content: unknown): ToolImageRef[] {
  let blocks: unknown[];
  if (Array.isArray(content)) {
    blocks = content;
  } else if (isRecord(content) && Array.isArray(content.content)) {
    blocks = content.content;
  } else {
    blocks = [];
  }
  const images: ToolImageRef[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    const { type, data, mimeType } = block;
    if (type !== 'image' || typeof data !== 'string' || !data) continue;
    const mime = typeof mimeType === 'string' && mimeType ? mimeType : 'image/png';
    if (blobHashOf(data)) {
      images.push({ mimeType: mime, blobRef: data });
    } else {
      images.push({ mimeType: mime, dataBase64: data });
    }
  }
  return images;
}

/**
 * The URL an `<img>` should load for a tool image, or null when the reference
 * carries no usable payload.
 *
 * A blob ref goes through Kabmo's own route rather than a `data:` URL:
 * the bytes live in omp's blob store on the server, and re-encoding a
 * multi-megabyte screenshot into the JSON payload of every session load is
 * exactly what the store exists to avoid. An inline payload is already bytes
 * the browser can paint, so it becomes a data URL.
 */
export function toolImageSrc(image: ToolImageRef): string | null {
  if (image.blobRef) {
    const hash = blobHashOf(image.blobRef);
    return hash ? `/api/omp/blob?hash=${hash}` : null;
  }
  if (image.dataBase64) {
    return `data:${image.mimeType};base64,${image.dataBase64}`;
  }
  return null;
}
