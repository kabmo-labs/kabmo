/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for file-kind classification.
 *
 * Getting this wrong is visible and expensive: a raster image misread as text
 * paints the editor with replacement characters, and an image served with the
 * wrong content-type is downloaded instead of painted. The extension cases pin
 * the parsing rules that the Files panel, the read route, and every viewer
 * share (dotfiles are not extensions, only the last dot counts, query and
 * fragment suffixes are not part of the name). The magic-byte cases use the
 * real leading bytes of each format so a signature table edit fails loudly.
 */

import { describe, expect, test } from 'bun:test';

import {
  DOCUMENT_MIME_BY_EXT,
  getDocumentMimeType,
  getFileExtension,
  getImageMimeFromBytes,
  getImageMimeType,
  getRawContentType,
  IMAGE_MIME_BY_EXT,
  SVG_MIME,
} from '@/shared/lib/fs/file-kind';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('getFileExtension', () => {
  test('missing paths have no extension', () => {
    expect(getFileExtension(undefined)).toBe('');
    expect(getFileExtension(null)).toBe('');
    expect(getFileExtension('')).toBe('');
  });

  test('a simple extension is lower-cased', () => {
    expect(getFileExtension('photo.PNG')).toBe('png');
    expect(getFileExtension('Photo.JpEg')).toBe('jpeg');
  });

  test('only the last dot of a multi-dot name counts', () => {
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
    expect(getFileExtension('app.min.js')).toBe('js');
  });

  test('a dotfile is a name, not an extension', () => {
    expect(getFileExtension('.env')).toBe('');
    expect(getFileExtension('.gitignore')).toBe('');
  });

  test('a leading dot does not hide a real extension', () => {
    expect(getFileExtension('.config.json')).toBe('json');
  });

  test('a trailing dot yields no extension', () => {
    expect(getFileExtension('archive.')).toBe('');
  });

  test('directories in the path are not part of the name', () => {
    expect(getFileExtension('src/lib/fs/file-kind.ts')).toBe('ts');
    expect(getFileExtension('C:\\proj\\src\\a.png')).toBe('png');
  });

  test('a query or fragment suffix is stripped', () => {
    expect(getFileExtension('a.png?v=2')).toBe('png');
    expect(getFileExtension('a.png#section')).toBe('png');
    // The `?` cuts the name short, so the `.png` in the query is irrelevant.
    expect(getFileExtension('a?v=1.png')).toBe('');
  });

  test('a read-tool selector is stripped, so the image sniff still sees the extension', () => {
    // `read /tmp/x.png:raw` — the sniff read the extension as `png:raw` and
    // answered "not an image", so the panel painted a code surface instead of
    // the picture the result carried.
    expect(getFileExtension('/tmp/x.png:raw')).toBe('png');
    expect(getFileExtension('x.pdf:1-5')).toBe('pdf');
    expect(getFileExtension('src/Read.tsx:205-215:raw')).toBe('tsx');
  });

  test('a directory-only path has no extension', () => {
    expect(getFileExtension('src/lib/')).toBe('');
  });
});

describe('getImageMimeType', () => {
  test('every table entry resolves to its MIME type', () => {
    expect(getImageMimeType('a.png')).toBe('image/png');
    expect(getImageMimeType('a.apng')).toBe('image/apng');
    expect(getImageMimeType('a.jpg')).toBe('image/jpeg');
    expect(getImageMimeType('a.jpeg')).toBe('image/jpeg');
    expect(getImageMimeType('a.jfif')).toBe('image/jpeg');
    expect(getImageMimeType('a.gif')).toBe('image/gif');
    expect(getImageMimeType('a.webp')).toBe('image/webp');
    expect(getImageMimeType('a.avif')).toBe('image/avif');
    expect(getImageMimeType('a.bmp')).toBe('image/bmp');
    expect(getImageMimeType('a.ico')).toBe('image/x-icon');
    expect(getImageMimeType('a.tif')).toBe('image/tiff');
    expect(getImageMimeType('a.tiff')).toBe('image/tiff');
  });

  test('the table covers exactly the extensions above', () => {
    expect(Object.keys(IMAGE_MIME_BY_EXT).sort()).toEqual([
      'apng',
      'avif',
      'bmp',
      'gif',
      'ico',
      'jfif',
      'jpeg',
      'jpg',
      'png',
      'tif',
      'tiff',
      'webp',
    ]);
  });

  test('SVG stays on the text path despite being a picture format', () => {
    expect(getImageMimeType('icon.svg')).toBeNull();
  });

  test('non-images and unknown extensions are null, not undefined', () => {
    expect(getImageMimeType('notes.txt')).toBeNull();
    expect(getImageMimeType('README')).toBeNull();
    expect(getImageMimeType(undefined)).toBeNull();
  });
});

describe('getDocumentMimeType', () => {
  test('each document extension resolves to its MIME type', () => {
    expect(getDocumentMimeType('a.pdf')).toBe('application/pdf');
    expect(getDocumentMimeType('a.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(getDocumentMimeType('a.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(getDocumentMimeType('a.xlsm')).toBe('application/vnd.ms-excel.sheet.macroEnabled.12');
  });

  test('the table covers exactly the extensions above', () => {
    expect(Object.keys(DOCUMENT_MIME_BY_EXT).sort()).toEqual(['docx', 'pdf', 'xlsm', 'xlsx']);
  });

  // `.xls` is the legacy OLE2 binary the reader refuses; naming it as a
  // spreadsheet type would advertise a viewer that cannot open it.
  test('legacy .xls has no MIME entry', () => {
    expect(getDocumentMimeType('legacy.xls')).toBeNull();
  });

  test('images and unknown extensions are null', () => {
    expect(getDocumentMimeType('a.png')).toBeNull();
    expect(getDocumentMimeType('a.ts')).toBeNull();
    expect(getDocumentMimeType(undefined)).toBeNull();
  });
});

describe('getRawContentType', () => {
  test('an image keeps its image type', () => {
    expect(getRawContentType('shot.png')).toBe('image/png');
  });

  test('a document gets its document type', () => {
    expect(getRawContentType('report.pdf')).toBe('application/pdf');
    expect(getRawContentType('book.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  // SVG is deliberately absent from the image table (it is editable text), but
  // the raw route still serves it to an <img>, so it must be named here or the
  // browser downloads the file instead of painting it.
  test('svg is named by the raw route even though it is not an image kind', () => {
    expect(getRawContentType('logo.svg')).toBe(SVG_MIME);
    expect(getImageMimeType('logo.svg')).toBeNull();
  });

  test('a text file has no raw content type', () => {
    expect(getRawContentType('a.ts')).toBeNull();
    expect(getRawContentType(undefined)).toBeNull();
  });
});

describe('getImageMimeFromBytes', () => {
  test('the PNG signature is recognized', () => {
    expect(getImageMimeFromBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
  });

  test('a truncated PNG signature does not match', () => {
    expect(getImageMimeFromBytes(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
  });

  test('the JPEG SOI marker is recognized', () => {
    expect(getImageMimeFromBytes(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });

  test('the GIF87a/89a header is recognized', () => {
    expect(getImageMimeFromBytes(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif');
  });

  test('WEBP is read from its tag at offset 8', () => {
    const riff = bytes(0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
    expect(getImageMimeFromBytes(riff)).toBe('image/webp');
  });

  test('a RIFF header too short to hold the WEBP tag is not WEBP', () => {
    const truncated = bytes(0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45);
    expect(getImageMimeFromBytes(truncated)).toBeNull();
  });

  test('AVIF is read from the ftyp brand at offset 4', () => {
    const ftyp = bytes(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66);
    expect(getImageMimeFromBytes(ftyp)).toBe('image/avif');
  });

  test('a non-avif ftyp brand does not match', () => {
    const ftyp = bytes(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32);
    expect(getImageMimeFromBytes(ftyp)).toBeNull();
  });

  test('BMP is recognized from its two-byte header', () => {
    expect(getImageMimeFromBytes(bytes(0x42, 0x4d))).toBe('image/bmp');
    expect(getImageMimeFromBytes(bytes(0x42, 0x4d, 0x36, 0x00))).toBe('image/bmp');
  });

  test('TIFF is recognized in both byte orders', () => {
    expect(getImageMimeFromBytes(bytes(0x49, 0x49, 0x2a, 0x00))).toBe('image/tiff');
    expect(getImageMimeFromBytes(bytes(0x4d, 0x4d, 0x00, 0x2a))).toBe('image/tiff');
  });

  test('ICO is recognized', () => {
    expect(getImageMimeFromBytes(bytes(0x00, 0x00, 0x01, 0x00))).toBe('image/x-icon');
  });

  test('unknown bytes and buffers shorter than any signature are null', () => {
    expect(getImageMimeFromBytes(bytes(0x00, 0x00, 0x00, 0x00))).toBeNull();
    expect(getImageMimeFromBytes(new Uint8Array(0))).toBeNull();
    expect(getImageMimeFromBytes(bytes(0x89))).toBeNull();
  });

  test('a UTF-8 text buffer is not mistaken for an image', () => {
    const text = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(getImageMimeFromBytes(text)).toBeNull();
  });

  test('the first matching signature wins when bytes overlap two formats', () => {
    // The table is ordered: 'BM' is checked before the ICO entry, so a buffer
    // whose bytes 2-5 happen to spell an ICO header is still a BMP.
    expect(getImageMimeFromBytes(bytes(0x42, 0x4d, 0x00, 0x00, 0x01, 0x00))).toBe('image/bmp');
  });
});

