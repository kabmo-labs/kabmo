/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatBytes } from '@/shared/lib/format/number';
import { stripReadSelector } from '@/shared/lib/fs/paths';

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
  const clean = stripReadSelector(filePath).split(/[/\\]/).pop() ?? '';
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
 * The largest file the editor will open when its bytes reach the page WHOLE.
 *
 * Not a policy knob: the editor holds the whole file in one string and posts
 * the whole thing back on every save, so a ceiling has to exist. 5 MiB is above
 * any source file and well below the size at which a textarea stops responding.
 *
 * A DOCX and an XLSX are parsed in the page too, but they get their own, higher
 * number — see `DOCUMENT_MAX_FILE_BYTES`.
 */
export const EDITOR_MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * The largest Word document or workbook the editor opens.
 *
 * `mammoth` and `read-excel-file` parse the fetched `ArrayBuffer` in the page,
 * so the file does sit in memory — but it is unzipped and converted once and
 * then released, where a text buffer is held for as long as the tab is open and
 * re-posted on every save. That is why these get four times the text ceiling
 * rather than the text ceiling itself: the reason the 5 MiB limit exists (a
 * textarea that stops responding) does not apply to a read-only conversion.
 *
 * Measured on a 15 MB workbook: the fetch, the unzip and the grid render all
 * complete, and the panel stays responsive.
 */
export const DOCUMENT_MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * The largest PDF the editor opens — above both, because a PDF is the one
 * document the page never holds.
 *
 * `PdfView` points an `<iframe>` at `/api/fs/raw`, so the bytes go straight to
 * Chrome's own viewer, which fetches them with range requests (verified: a
 * `Range: bytes=0-1023` request answers `206` with `content-range` and
 * `accept-ranges`, and the plugin issues its own ranges as the reader scrolls).
 * Nothing in Kabmo buffers the file, so the text ceiling has no reason to
 * apply to it — and applying it was the bug: a 6 MB PDF dragged from Finder was
 * refused as "larger than the 5.00 MB the editor opens" before the document
 * branch was ever reached, because the size test runs first.
 */
export const PDF_MAX_FILE_BYTES = 30 * 1024 * 1024;

/**
 * Extensions whose ceiling differs from `EDITOR_MAX_FILE_BYTES`.
 *
 * One table, read by the size test, by the refusal sentence AND by
 * `/api/fs/raw`, because the sentence names the number to the user and the raw
 * route is the one place every viewer's bytes come through: two copies of the
 * rule would let a file be refused against one limit, explained against another
 * and streamed past a third.
 *
 * An extension absent from this table falls back to the text ceiling — except
 * an image, which is exempt from the size test entirely because `/api/fs/raw`
 * streams it to an `<img>` and nothing is ever buffered.
 */
export const EDITOR_MAX_BYTES_BY_EXT: Record<string, number> = {
  pdf: PDF_MAX_FILE_BYTES,
  docx: DOCUMENT_MAX_FILE_BYTES,
  xlsx: DOCUMENT_MAX_FILE_BYTES,
  xlsm: DOCUMENT_MAX_FILE_BYTES,
};

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
 * A PDF is the same answer for the same reason, up to a higher ceiling: its
 * viewer is an `<iframe>` on `/api/fs/raw`, so the bytes are streamed to
 * Chrome's own plugin and never held in the page.
 *
 * A DOCX and an XLSX are the middle case: `mammoth` and `read-excel-file` parse
 * the fetched `ArrayBuffer` in the page, so the file IS held — but only for the
 * conversion, not for the life of the tab, which is what buys them
 * `DOCUMENT_MAX_FILE_BYTES` (20 MiB) instead of the text ceiling.
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
  if (options.size > (EDITOR_MAX_BYTES_BY_EXT[getFileExtension(options.path)] ?? EDITOR_MAX_FILE_BYTES)) {
    return 'too-large';
  }
  if (getDocumentMimeType(options.path)) return 'document';
  if (options.head?.includes(0)) return 'binary';
  return 'text';
}

/**
 * The sentence shown where the document would have been.
 *
 * Shared so the drop target, the editor surface and the read route's refusal
 * cannot word the same refusal three ways.
 *
 * The limit is derived from `path`, so the number in the sentence is the number
 * the classifier actually applied: a 31 MB PDF is refused against 30 MB, never
 * against the 5 MB a text file would get.
 */
export function unsupportedEditorMessage(
  kind: 'binary' | 'too-large',
  size?: number,
  path?: string | null,
): string {
  if (kind === 'too-large') {
    const limit = formatBytes(EDITOR_MAX_BYTES_BY_EXT[getFileExtension(path)] ?? EDITOR_MAX_FILE_BYTES);
    return size === undefined
      ? `This file is larger than the ${limit} the editor opens.`
      : `This file is ${formatBytes(size)} — larger than the ${limit} the editor opens.`;
  }
  return 'This file is not text, so it cannot be shown in the editor.';
}
