/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/connect/pair/qr.png` — the download a host's own machinery fetches.
 *
 * The route exists because a download cannot run the page's renderer: Android's
 * `DownloadManager`, iOS's `WKDownload` and the desktop shells all fetch an
 * `http` URL with the session cookie and hand the bytes to the user. A `blob:`
 * URL the page built is exactly what those paths ignore, which is what made the
 * button do nothing in the shell.
 *
 * The cases pin the two halves of that contract: a live code answers a real PNG
 * with an attachment name, and a code that expired or was redeemed answers a
 * sentence instead of an empty image.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { loader } from '@/server/routes/connect/pair-qr';
import { attachPairingQr, createPairing, resetPairings } from '@/server/lib/connect/pairing.server';
import { qrPng } from '@/server/lib/connect/qr-png.server';
import { qrMatrix } from '@/server/lib/connect/qr.server';

const CANDIDATES = [{ kind: 'lan' as const, url: 'http://192.168.18.76:3000' }];
const PNG = qrPng(qrMatrix('https://kabmo.example/pair#abc'));

async function download(pairingId: string) {
  const url = new URL('http://localhost/api/connect/pair/qr.png');
  url.searchParams.set('pairingId', pairingId);
  return loader({ request: new Request(url) } as never);
}

afterEach(() => {
  resetPairings();
});

describe('pairing QR download', () => {
  test('serves the PNG as an attachment named for the file the user gets', async () => {
    const { pairingId } = createPairing(CANDIDATES);
    attachPairingQr(pairingId, PNG);

    const response = await download(pairingId);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="kabmo-pairing-qr.png"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  test('answers an explanation once the code is gone, never an empty file', async () => {
    const { pairingId } = createPairing(CANDIDATES);
    attachPairingQr(pairingId, PNG);
    resetPairings();

    const response = await download(pairingId);
    expect(response.status).toBe(410);
    expect(await response.text()).toContain('expired');
  });

  test('a code that was never drawn has nothing to download', async () => {
    const { pairingId } = createPairing(CANDIDATES);
    const response = await download(pairingId);
    expect(response.status).toBe(410);
  });

  test('a missing pairing id is refused rather than reading the store', async () => {
    const response = await download('');
    expect(response.status).toBe(410);
  });
});
