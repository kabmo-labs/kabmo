/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MIME tables, and the only functions that read them.
 *
 * Split from `file-kind` for the per-file ceiling, and it earns the boundary:
 * every question here is "what does this PATH's extension say it is", while
 * `file-kind` answers "what can the editor DO with these bytes". They are read
 * by different halves of the app — the icon, the viewer, `/api/fs/raw`, the
 * blob store — and every one of them must give the same answer, which is why
 * there is exactly one table per question and one getter per table.
 *
 * A raster image is not text: decoding its bytes as UTF-8 yields replacement
 * characters, so the editor used to paint a PNG as mojibake. The extension is
 * the only signal available before reading the file, and it is the same signal
 * the Files panel already uses to pick an icon — keeping it in one module means
 * the reader, the icon, and the viewer can never disagree about which files are
 * pictures.
 *
 * SVG is deliberately absent from the image table: it is editable XML text and
 * stays on the syntax-highlighted code path.
 */

import { stripReadSelector } from './paths';

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
  xls: 'application/vnd.ms-excel',
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
 * MIME types for the assets a rendered web page loads, served by `/api/fs/raw`.
 *
 * The HTML preview hands a page to a sandboxed frame, and the browser applies
 * STRICT MIME checking there: a `<link rel="stylesheet">` answered as
 * `application/octet-stream` is refused ("MIME type ('application/octet-stream')
 * is not a supported stylesheet MIME type"), and a `<script>` likewise. So a
 * page with a relative stylesheet or script — every page that is not a single
 * self-contained file — painted unstyled until this table existed.
 *
 * Deliberately NOT part of `DOCUMENT_MIME_BY_EXT`: that table's members are
 * classified `document` by `classifyEditorFile`, which would take `.css` and
 * `.js` off the editable text path. These files stay text; only the raw
 * route's `content-type` needs to name them.
 */
export const WEB_ASSET_MIME_BY_EXT: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
};

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
 * MIME type for a path an `<img>` can PAINT — every raster image plus SVG — or
 * null.
 *
 * The chat `read` card is the caller that needs this third answer: it paints the
 * file a tool returned, and an SVG is a picture there even though the editor
 * keeps it on the code path (`getImageMimeType` stays raster-only for that
 * reason). One function, so the read panel and `/api/fs/raw` cannot disagree
 * about which files are previewable.
 */
export function getPaintableImageMimeType(filePath: string | undefined | null): string | null {
  return getImageMimeType(filePath) ?? (getFileExtension(filePath) === 'svg' ? SVG_MIME : null);
}

/**
 * The `content-type` `/api/fs/raw` should answer a path with, or null when the
 * bytes have no picture/document type (the route falls back to
 * `application/octet-stream`).
 *
 * SVG is named through `getPaintableImageMimeType` rather than by
 * `getImageMimeType` because the classifier must keep it on the text path while
 * the raw route serves it to an `<img>`.
 *
 * The web-asset table is last because it is the least specific answer: a page's
 * stylesheet, script, font or wasm module still needs a real `content-type`, or
 * the sandboxed preview frame refuses it under strict MIME checking.
 */
export function getRawContentType(filePath: string | undefined | null): string | null {
  return (
    getPaintableImageMimeType(filePath) ??
    getDocumentMimeType(filePath) ??
    WEB_ASSET_MIME_BY_EXT[getFileExtension(filePath)] ??
    null
  );
}
