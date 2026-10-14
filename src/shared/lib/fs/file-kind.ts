/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatBytes } from '@/shared/lib/format/number';

/**
 * File-kind classification shared by the server read routes and every client
 * viewer (desktop editor, mobile editor, chat tool panels).
 *
 * A raster image is not text: decoding its bytes as UTF-8 yields replacement
 * characters, so the editor used to paint a PNG as mojibake. The extension is
 * the only signal available before reading the file, and it is the same signal
 * the Files panel already uses to pick an icon — keeping it in one module means
 * the reader, the icon, and the viewer can never disagree about which files are
 * pictures.
 *
 * SVG is deliberately absent: it is editable XML text and stays on the
 * syntax-highlighted code path.
 */
export const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

/** Lower-cased extension of a path or name, query/fragment/line suffix removed. */
export function getFileExtension(filePath: string | undefined | null): string {
  if (!filePath) return '';
  const clean = filePath.split('?')[0].split('#')[0].split(/[/\\]/).pop() ?? '';
  const dot = clean.lastIndexOf('.');
  return dot > 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

/**
 * MIME types for the documents the editor renders rather than edits — the ones
 * `/api/fs/raw` must label correctly, because the browser decides whether to
 * paint or download from `content-type`.
 *
 * These are NOT in `IMAGE_MIME_BY_EXT`: an image is classified `image` (streamed,
 * size-exempt) while these are classified `document` (bytes fetched whole by the
 * viewer, size-checked like text). One table for the MIME, one list for the
 * classification, so the two questions cannot drift.
 */
export const DOCUMENT_MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
};

/**
 * SVG's MIME. Kept out of every classification table on purpose: an SVG is
 * editable XML text and stays on the code path (see the module doc), but
 * `/api/fs/raw` still has to name it, or an `<img>` pointed at it downloads the
 * file instead of painting it.
 */
export const SVG_MIME = 'image/svg+xml';

/**
 * MIME type for a raster image path, or null when the extension is not one.
 * Null is the "treat as text" answer, so every caller branches on this single
 * check instead of re-deriving the extension list.
 */
export function getImageMimeType(filePath: string | undefined | null): string | null {
  return IMAGE_MIME_BY_EXT[getFileExtension(filePath)] ?? null;
}

/**
 * MIME type for a document the viewer paints (PDF, DOCX, XLSX/XLSM), or null.
 * Null is the "not one of those" answer, the same shape `getImageMimeType` uses.
 */
export function getDocumentMimeType(filePath: string | undefined | null): string | null {
  return DOCUMENT_MIME_BY_EXT[getFileExtension(filePath)] ?? null;
}

/**
 * The `content-type` `/api/fs/raw` should answer a path with, or null when the
 * bytes have no picture/document type (the route falls back to
 * `application/octet-stream`).
 *
 * SVG is named here rather than by `getImageMimeType` because it is deliberately
 * excluded there — the classifier must keep it on the text path — while the raw
 * route serves it to an `<img>`.
 */
export function getRawContentType(filePath: string | undefined | null): string | null {
  return (
    getImageMimeType(filePath) ??
    getDocumentMimeType(filePath) ??
    (getFileExtension(filePath) === 'svg' ? SVG_MIME : null)
  );
}

/** Leading bytes → MIME, longest signature first so `webp`'s `RIFF`/`WEBP`
 *  pair is checked before a bare container match could accept it. */
const IMAGE_MAGIC: { bytes: number[]; mime: string; offset?: number }[] = [
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: 'image/png' },
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' },
  // RIFF????WEBP — the tag sits at offset 8, after the 4-byte size field.
  { bytes: [0x57, 0x45, 0x42, 0x50], mime: 'image/webp', offset: 8 },
  { bytes: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], mime: 'image/avif', offset: 4 },
  { bytes: [0x42, 0x4d], mime: 'image/bmp' },
  { bytes: [0x49, 0x49, 0x2a, 0x00], mime: 'image/tiff' },
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], mime: 'image/tiff' },
  { bytes: [0x00, 0x00, 0x01, 0x00], mime: 'image/x-icon' },
];

/**
 * MIME type for a raster image read from its own bytes, or null when no
 * signature matches.
 *
 * The extension is not always available: omp's blob store names a file by its
 * content hash and writes the extension onto a hardlink beside it, so a store
 * pruned of those links — or a ref whose `mimeType` field the caller lost —
 * leaves the bytes as the only evidence. A wrong `content-type` is not
 * cosmetic here: `image/*` is what makes the browser paint rather than download.
 */
export function getImageMimeFromBytes(bytes: Uint8Array): string | null {
  for (const { bytes: magic, mime, offset = 0 } of IMAGE_MAGIC) {
    if (bytes.length < offset + magic.length) continue;
    let matched = true;
    for (let i = 0; i < magic.length; i += 1) {
      if (bytes[offset + i] !== magic[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return mime;
  }
  return null;
}

/**
 * The largest file the editor will open.
 *
 * Not a policy knob: the editor holds the whole file in one string and posts
 * the whole thing back on every save, so a ceiling has to exist. 5 MiB is above
 * any source file and well below the size at which a textarea stops responding.
 */
export const EDITOR_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** How many leading bytes are inspected for binary content. */
export const BINARY_SNIFF_BYTES = 8192;

/**
 * What the editor can do with a file, decided from the path, its size and its
 * leading bytes — the ONE classification the read route, the editor surface and
 * the drop target all branch on.
 *
 * `text`, `image` and `document` are openable; `binary` and `too-large` are not,
 * and each says why so the refusal can name the actual reason instead of "could
 * not read".
 */
export type EditorFileKind = 'image' | 'document' | 'text' | 'binary' | 'too-large';

/**
 * Classify a file for the editor.
 *
 * An image is checked FIRST and stays openable whatever its size: `/api/fs/raw`
 * streams it and the browser paints it, so a large picture costs no buffer.
 *
 * A document (PDF/DOCX/XLSX) is the opposite: the viewer fetches its bytes
 * whole and hands them to a parser, so it is refused for size exactly like text
 * — the same ceiling, applied before the bytes are looked at.
 *
 * The binary test is a NUL byte in the leading bytes — git's own test, and the
 * boring one: no encoding a source file uses puts a NUL inside a character,
 * while every container format (zip, PNG, wasm, sqlite, a compiled object) has
 * one early. A document is exempt from that sniff, because every one of them IS
 * a container: a DOCX and an XLSX are zips and a PDF carries binary streams, so
 * the sniff would refuse exactly the files the viewer exists for. Sniffing only
 * the head keeps the check off the read path's critical section.
 *
 * `head` may be omitted when the caller has already refused on size or kind —
 * a missing head is treated as text, which is the answer that opens the file.
 */
export function classifyEditorFile(options: {
  path?: string | null;
  size: number;
  head?: Uint8Array;
}): EditorFileKind {
  if (getImageMimeType(options.path)) return 'image';
  if (options.size > EDITOR_MAX_FILE_BYTES) return 'too-large';
  if (getDocumentMimeType(options.path)) return 'document';
  if (options.head?.includes(0)) return 'binary';
  return 'text';
}

/**
 * The sentence shown where the document would have been.
 *
 * Shared so the drop target, the editor surface and the read route's refusal
 * cannot word the same refusal three ways.
 */
export function unsupportedEditorMessage(kind: 'binary' | 'too-large', size?: number): string {
  if (kind === 'too-large') {
    const limit = formatBytes(EDITOR_MAX_FILE_BYTES);
    return size === undefined
      ? `This file is larger than the ${limit} the editor opens.`
      : `This file is ${formatBytes(size)} — larger than the ${limit} the editor opens.`;
  }
  return 'This file is not text, so it cannot be shown in the editor.';
}
