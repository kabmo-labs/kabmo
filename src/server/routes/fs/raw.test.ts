/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The raw route's PDF ceiling.
 *
 * `/api/fs/raw` is the one route every viewer's bytes come through, so it is the
 * only place the 30 MB limit can hold for every entry point at once. The Files
 * panel's own click never checked a size at all (a 45 MB PDF opened from the
 * tree), and a drop goes through `/api/fs/scope`, which refuses the TAB rather
 * than the stream — a stale tab, a second browser or a hand-typed URL reached
 * the bytes anyway.
 *
 * Only the PDF ceiling is applied. An image, a DOCX and a plain file reached
 * this route before this gate existed and still do: adding a ceiling they never
 * had would be a different change than the one asked for, and the tests below
 * pin that boundary so it is a decision rather than an accident.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { serveRawFile } from '@/server/routes/fs/raw';
import { DOCUMENT_MAX_FILE_BYTES, PDF_MAX_FILE_BYTES } from '@/shared/lib/fs/file-kind';

const DIR = path.join(process.cwd(), 'tmp-raw-ceiling');

afterEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
});

async function raw(relPath: string, init?: RequestInit) {
  const url = new URL('http://localhost/api/fs/raw');
  url.searchParams.set('path', relPath);
  url.searchParams.set('root', DIR);
  const res = await serveRawFile({ request: new Request(url, init) } as never);
  return res;
}

function write(relPath: string, bytes: Uint8Array) {
  const target = path.join(DIR, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return target;
}

describe('fs raw route', () => {
  test('a PDF at the ceiling is served', async () => {
    write('report.pdf', new Uint8Array(PDF_MAX_FILE_BYTES).fill(0x25));
    const res = await raw('report.pdf');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  test('a PDF past the ceiling is refused, naming 30 MB', async () => {
    write('huge.pdf', new Uint8Array(PDF_MAX_FILE_BYTES + 1).fill(0x25));
    const res = await raw('huge.pdf');

    expect(res.status).toBe(415);
    const body = (await res.json()) as { error?: string; kind?: string };
    expect(body.kind).toBe('too-large');
    expect(body.error).toContain('30.00 MB');
  });

  // The ceiling is the PDF's alone. A large image and a large text file are
  // streamed here today and must keep being streamed.
  test('a large image is still served', async () => {
    write('big.png', new Uint8Array(PDF_MAX_FILE_BYTES + 1).fill(0x89));
    const res = await raw('big.png');

    expect(res.status).toBe(200);
  });

  test('a large text file is still served', async () => {
    write('big.log', new Uint8Array(PDF_MAX_FILE_BYTES + 1).fill(0x61));
    const res = await raw('big.log');

    expect(res.status).toBe(200);
  });

  // A DOCX is gated too, at its own (lower) ceiling: its viewer parses the
  // bytes in the page, so the 20 MB limit has to hold at the route as well as
  // in the classifier — otherwise a stale tab streams past what the reader
  // would have refused.
  test('a DOCX at the document ceiling is served', async () => {
    write('report.docx', new Uint8Array(DOCUMENT_MAX_FILE_BYTES).fill(0x50));
    const res = await raw('report.docx');

    expect(res.status).toBe(200);
  });

  test('a DOCX past the document ceiling is refused, naming 20 MB', async () => {
    write('huge.docx', new Uint8Array(DOCUMENT_MAX_FILE_BYTES + 1).fill(0x50));
    const res = await raw('huge.docx');

    expect(res.status).toBe(415);
    const body = (await res.json()) as { error?: string; kind?: string };
    expect(body.kind).toBe('too-large');
    expect(body.error).toContain('20.00 MB');
  });

  // A range request is answered by `Bun.serve`'s own layer, not by this handler
  // (verified against a live server: `Range: bytes=0-0` answers `206` with
  // `content-range` and `accept-ranges`), so what this test pins is the part the
  // handler owns — an allowed PDF is streamed whole with its length and type,
  // which is what the range layer then slices.
  test('an allowed PDF is streamed with its type and length', async () => {
    write('report.pdf', new Uint8Array(4096).fill(0x25));
    const res = await raw('report.pdf');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-length')).toBe('4096');
    expect(res.headers.get('content-disposition')).toContain('report.pdf');
  });

  test('a missing file is a 404', async () => {
    const res = await raw('ghost.pdf');
    expect(res.status).toBe(404);
  });
});
