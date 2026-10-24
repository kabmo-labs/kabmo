/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `classifyEditorFile` and the refusal it produces — the ONE decision the read
 * route, the editor surface and the drop target all branch on.
 *
 * Split from `file-kind.test.ts` at the repository's per-file line ceiling, and
 * the boundary is the module's own: that file covers the MIME tables and the
 * extension parsing, this one covers what the classification DOES with them.
 *
 * The size tests are the ones that matter most, because two ceilings exist and
 * they are not interchangeable: a PDF is streamed to the browser's own viewer
 * (30 MiB), while a DOCX, an XLSX and every text file are held in the page
 * (5 MiB). Getting that pair backwards is what refused a 6 MB PDF before its
 * document branch was ever reached.
 */

import { describe, expect, test } from 'bun:test';

import {
  BINARY_SNIFF_BYTES,
  classifyEditorFile,
  DOCUMENT_MAX_FILE_BYTES,
  EDITOR_MAX_FILE_BYTES,
  PDF_MAX_FILE_BYTES,
  unsupportedEditorMessage,
} from '@/shared/lib/fs/file-kind';
import { formatBytes } from '@/shared/lib/format/number';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('classifyEditorFile', () => {
  test('an image stays openable whatever its size, because it is streamed', () => {
    // 40 MiB PNG: refused for size would be wrong — `/api/fs/raw` streams it and
    // the browser paints it, so no buffer is ever held.
    expect(classifyEditorFile({ path: 'shot.png', size: 40 * 1024 * 1024 })).toBe('image');
  });

  test('size is refused before the bytes are looked at', () => {
    const oversize = EDITOR_MAX_FILE_BYTES + 1;
    // Binary-looking head AND oversize: the size answer wins, because a file
    // too large to hold is also too large to have sniffed.
    expect(classifyEditorFile({ path: 'dump.log', size: oversize, head: bytes(0x00) })).toBe('too-large');
  });

  test('a file exactly at the ceiling is still text', () => {
    expect(classifyEditorFile({ path: 'big.ts', size: EDITOR_MAX_FILE_BYTES })).toBe('text');
  });

  test('a NUL in the head is binary, and its absence is text', () => {
    expect(classifyEditorFile({ path: 'app.zip', size: 1024, head: bytes(0x50, 0x4b, 0x00) })).toBe('binary');
    expect(classifyEditorFile({ path: 'app.ts', size: 1024, head: bytes(0x63, 0x6f, 0x6e) })).toBe('text');
  });

  // A DOCX and an XLSX are zips and a PDF carries binary streams, so the NUL
  // sniff would refuse exactly the files the viewer exists for. The document
  // branch runs before it.
  test('a document is exempt from the binary sniff', () => {
    expect(classifyEditorFile({ path: 'report.pdf', size: 4096, head: bytes(0x25, 0x50, 0x44, 0x46) })).toBe('document');
    expect(classifyEditorFile({ path: 'doc.docx', size: 4096, head: bytes(0x50, 0x4b, 0x03, 0x04, 0x00) })).toBe('document');
    expect(classifyEditorFile({ path: 'sheet.xlsx', size: 4096, head: bytes(0x50, 0x4b, 0x03, 0x04, 0x00) })).toBe('document');
    expect(classifyEditorFile({ path: 'sheet.xlsm', size: 4096 })).toBe('document');
  });

  // A PDF is the exception: its viewer is an `<iframe>` on `/api/fs/raw`, so the
  // bytes are streamed to Chrome's own plugin (which range-fetches them) and the
  // page never holds the file. The text ceiling refused a 6 MB PDF before the
  // document branch was reached, which is what "the PDF fails to render" was.
  test('a PDF stays openable up to the PDF ceiling', () => {
    expect(classifyEditorFile({ path: 'report.pdf', size: 6 * 1024 * 1024 })).toBe('document');
    expect(classifyEditorFile({ path: 'report.pdf', size: PDF_MAX_FILE_BYTES })).toBe('document');
    expect(classifyEditorFile({ path: 'REPORT.PDF', size: 29 * 1024 * 1024 })).toBe('document');
  });

  test('a PDF past the PDF ceiling is refused for size', () => {
    expect(classifyEditorFile({ path: 'huge.pdf', size: PDF_MAX_FILE_BYTES + 1 })).toBe('too-large');
  });

  // Each ceiling belongs to its own kind. A DOCX and an XLSX are parsed in the
  // page, so they sit below the PDF's 30 MiB — but well above the text ceiling,
  // because the file is held only for the conversion, not for the life of the
  // tab.
  test('a DOCX and an XLSX stay openable up to the document ceiling', () => {
    expect(classifyEditorFile({ path: 'big.docx', size: 6 * 1024 * 1024 })).toBe('document');
    expect(classifyEditorFile({ path: 'big.xlsx', size: 19 * 1024 * 1024 })).toBe('document');
    expect(classifyEditorFile({ path: 'big.xlsm', size: DOCUMENT_MAX_FILE_BYTES })).toBe('document');
  });

  test('a DOCX and an XLSX past the document ceiling are refused for size', () => {
    const over = DOCUMENT_MAX_FILE_BYTES + 1;
    expect(classifyEditorFile({ path: 'big.docx', size: over })).toBe('too-large');
    expect(classifyEditorFile({ path: 'big.xlsx', size: over })).toBe('too-large');
  });

  // The document ceiling does not reach plain text: a 6 MB source file is still
  // refused, because a textarea holds that buffer for the life of the tab.
  test('plain text keeps the text ceiling, which a real source file clears', () => {
    // 6 MB was over the old 5 MiB ceiling and is a normal generated file, not a
    // refusal. The ceiling moved; this case is what keeps it from moving back.
    expect(classifyEditorFile({ path: 'big.ts', size: 6 * 1024 * 1024 })).toBe('text');
    expect(classifyEditorFile({ path: 'big.log', size: EDITOR_MAX_FILE_BYTES })).toBe('text');
    expect(classifyEditorFile({ path: 'big.log', size: EDITOR_MAX_FILE_BYTES + 1 })).toBe('too-large');
  });

  test('a missing head is text — the answer that opens the file', () => {
    expect(classifyEditorFile({ path: 'notes.txt', size: 512 })).toBe('text');
  });

  test('an extensionless file with a text head is text', () => {
    expect(classifyEditorFile({ path: 'bin/run', size: 200, head: bytes(0x23, 0x21) })).toBe('text');
  });

  test('the sniff window is what a caller slices, and it fits every head above', () => {
    expect(BINARY_SNIFF_BYTES).toBeGreaterThan(8);
  });
});

describe('unsupportedEditorMessage', () => {
  test('a binary refusal says the file is not text', () => {
    expect(unsupportedEditorMessage('binary')).toContain('not text');
  });

  test('a size refusal names both the actual size and the ceiling', () => {
    // Derived, never spelled out: the point of the sentence is that its number
    // is the one the classifier applied, so a literal here would pass while the
    // two disagreed.
    const message = unsupportedEditorMessage('too-large', 40 * 1024 * 1024);
    expect(message).toContain('40.00 MB');
    expect(message).toContain(formatBytes(EDITOR_MAX_FILE_BYTES));
  });

  test('a size refusal without a measured size names only the ceiling', () => {
    const message = unsupportedEditorMessage('too-large');
    expect(message).toContain(formatBytes(EDITOR_MAX_FILE_BYTES));
    expect(message).not.toContain('undefined');
  });

  test('the text ceiling leaves room for a real source file and stops short of the knee', () => {
    // 32 MiB: measured, the last size before a tab's heap crosses a gigabyte and
    // a 64 MB file stops opening at all (see the constant's own table).
    expect(EDITOR_MAX_FILE_BYTES).toBe(32 * 1024 * 1024);
    expect(EDITOR_MAX_FILE_BYTES).toBeGreaterThan(DOCUMENT_MAX_FILE_BYTES);
  });

  // The sentence names the number the classifier actually applied: a PDF is
  // refused against its own ceiling, so naming the text one would describe a
  // limit the file was never measured against.
  test('a PDF size refusal names the PDF ceiling, not the text one', () => {
    const message = unsupportedEditorMessage('too-large', 31 * 1024 * 1024, 'docs/report.pdf');
    expect(message).toContain('31.00 MB');
    expect(message).toContain(formatBytes(PDF_MAX_FILE_BYTES));
    expect(message).not.toContain(formatBytes(EDITOR_MAX_FILE_BYTES));
  });
});