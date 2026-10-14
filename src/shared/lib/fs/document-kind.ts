/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which VIEWER a file gets, derived from its path alone.
 *
 * Separate from `file-kind` on purpose: that module answers "can the editor
 * open this at all?" (text, image, binary, too large) and is the gate the
 * server routes apply. This one answers "and which surface draws it?", which
 * only the client asks. Keeping them apart means the read route never has to
 * know that a `.csv` is rendered as a grid, and the grid never has to know how
 * a file was classified.
 *
 * Every table here is data with a rule that reads it, never a chain of `if`s at
 * a call site: a new viewer is a row, and the three surfaces that dispatch on
 * the answer (the desktop pane, the phone's full-screen editor, the toolbar's
 * eye button) all read the same tables, so they cannot disagree about which
 * file has a rendered form.
 */

import { getFileExtension, getImageMimeType } from '@/shared/lib/fs/file-kind';

/**
 * The surface that draws a file.
 *
 * `code` is the fallback: the syntax-highlighted text surface, which is what
 * every unrecognised extension gets.
 */
export type ViewerKind =
  | 'code'
  | 'markdown'
  | 'svg'
  | 'csv'
  | 'image'
  | 'pdf'
  | 'docx'
  | 'spreadsheet';

/** Word-processing documents mammoth reads. */
const DOCX_EXTENSIONS: Record<string, true> = { docx: true };

/**
 * Workbooks `read-excel-file` reads. `.xls` is deliberately absent: it is the
 * legacy OLE2 binary format, the reader refuses it outright with
 * `XLS_FILE_NOT_SUPPORTED`, and offering the viewer would produce a parse error
 * where the honest answer is "not text, cannot be shown here".
 */
const SHEET_EXTENSIONS: Record<string, true> = { xlsx: true, xlsm: true };

/** Delimited text rendered as a grid. */
const CSV_EXTENSIONS: Record<string, true> = { csv: true, tsv: true };

/** Markdown, whose preview is the rendered document. */
const MARKDOWN_EXTENSIONS: Record<string, true> = { md: true, markdown: true, mdx: true };

/**
 * A viewer that draws BYTES rather than a text buffer.
 *
 * The editor keeps no buffer and offers no Save for these: the bytes are
 * fetched (or read from the tab's live handle) and painted, so a write would
 * have nothing to write from. `image` is here because it already worked this
 * way — this is the generalisation, not a second rule.
 */
export const BINARY_VIEWERS: Record<ViewerKind, true | undefined> = {
  image: true,
  pdf: true,
  docx: true,
  spreadsheet: true,
  code: undefined,
  markdown: undefined,
  svg: undefined,
  csv: undefined,
};

/**
 * A viewer with a source ⇄ rendered toggle, which is the toolbar's eye button.
 *
 * `csv` is here even though it has no separate "source" surface: the grid IS
 * the preview and the raw text is the code surface, which is exactly the pair
 * the toggle switches between. `image` and the document kinds are not — they
 * have no text form to toggle to.
 */
export const RENDERED_VIEWERS: Record<ViewerKind, true | undefined> = {
  markdown: true,
  svg: true,
  csv: true,
  code: undefined,
  image: undefined,
  pdf: undefined,
  docx: undefined,
  spreadsheet: undefined,
};

/**
 * The word a status strip prints for a viewer kind.
 *
 * The phone's footer reads this instead of the language badge, because a byte
 * viewer has no text buffer: a PDF drawn in an iframe reported `TEXT · 1 lines ·
 * 0 chars` — the empty buffer's statistics describing a document that is not
 * text at all. The desktop pane has no such strip, so this label exists for the
 * surface that does.
 */
export const VIEWER_LABELS: Record<ViewerKind, string> = {
  code: 'Text',
  markdown: 'Markdown',
  svg: 'SVG',
  csv: 'CSV',
  image: 'Image',
  pdf: 'PDF',
  docx: 'Document',
  spreadsheet: 'Spreadsheet',
};

/**
 * The viewer for a path.
 *
 * Order is load-bearing in one place: `svg` is checked before the raster-image
 * table, because an SVG is a picture to the eye while its bytes are editable
 * XML text — and `file-kind` deliberately leaves it on the text path for that
 * reason. The viewer still renders it as a picture; the eye toggle is what
 * gives the source back.
 */
export function viewerKindFor(filePath: string | undefined | null): ViewerKind {
  const ext = getFileExtension(filePath);
  if (!ext) return 'code';
  if (ext === 'svg') return 'svg';
  if (MARKDOWN_EXTENSIONS[ext]) return 'markdown';
  if (getImageMimeType(filePath)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (DOCX_EXTENSIONS[ext]) return 'docx';
  if (SHEET_EXTENSIONS[ext]) return 'spreadsheet';
  if (CSV_EXTENSIONS[ext]) return 'csv';
  return 'code';
}
