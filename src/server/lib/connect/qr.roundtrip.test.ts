/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The QR the server draws, decoded back.
 *
 * This is the one claim the pairing feature cannot afford to be wrong about: a
 * code that renders but does not scan is indistinguishable from a broken camera,
 * and the user's next move — rescan, restart the app — is the wrong one. The
 * round trip is checked with the SAME decoder the login screen uses (`jsQR`), so
 * a change to the encoder, the error-correction level or the payload size that
 * pushes the code past what a phone can read fails here instead of in a hand.
 *
 * The matrix is expanded to RGBA by hand rather than through a PNG: the encoder
 * produces modules, and going through an image format would test the image
 * library instead of the code.
 */

import { describe, expect, test } from 'bun:test';
import jsQR from 'jsqr';
import { qrMatrix } from '@/server/lib/connect/qr.server';
import { encodePairingFragment, encodePairingPayload } from '@/shared/lib/connect/payload';

/** Modules per side of the quiet zone a scanner needs. */
const QUIET = 4;
/** Pixels per module. A phone camera needs a few; 4 is what the dialog draws. */
const SCALE = 4;

/** The matrix as RGBA pixels, black on white, with its quiet zone. */
function pixelsOf(rows: string[], size: number): { data: Uint8ClampedArray; width: number; height: number } {
  const span = (size + QUIET * 2) * SCALE;
  const data = new Uint8ClampedArray(span * span * 4).fill(255);
  for (let row = 0; row < size; row += 1) {
    const line = rows[row] ?? '';
    for (let column = 0; column < size; column += 1) {
      if (line[column] !== '1') continue;
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const x = (column + QUIET) * SCALE + dx;
          const y = (row + QUIET) * SCALE + dy;
          const index = (y * span + x) * 4;
          data[index] = 0;
          data[index + 1] = 0;
          data[index + 2] = 0;
        }
      }
    }
  }
  return { data, width: span, height: span };
}

function decode(text: string): string | null {
  const matrix = qrMatrix(text);
  const pixels = pixelsOf(matrix.rows, matrix.size);
  return jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null;
}

describe('the pairing QR decodes', () => {
  test('a browser link with one candidate', () => {
    const fragment = encodePairingFragment({
      v: 1,
      pairingId: 'pair-1',
      secret: 's'.repeat(43),
      serverId: 'server-1',
      label: 'rajeb-macbook',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      candidates: [{ kind: 'tailscale', url: 'https://node.tailnet.ts.net' }],
    });
    const link = `https://node.tailnet.ts.net/pair#${fragment}`;
    expect(decode(link)).toBe(link);
  });

  test('a browser link with four LAN candidates — the widest payload the page mints', () => {
    const fragment = encodePairingFragment({
      v: 1,
      pairingId: 'c823cb3b-3baf-4913-84bc-d23a927a00a3',
      secret: 'nchQ2h-p_F6e91pYoTH67sHVx6wRFZUHGPKlpgP07yQ',
      serverId: 'AIJ2AIfUYpTIIt4uHx0iQvL7dQ5m5VkXZWy3PmhbVHQ',
      label: 'Wijanarkos-Mac-mini',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      candidates: [
        { kind: 'lan', url: 'http://192.168.18.79:3990' },
        { kind: 'lan', url: 'http://100.98.171.79:3990' },
        { kind: 'lan', url: 'http://192.168.139.3:3990' },
        { kind: 'lan', url: 'http://172.16.102.251:3990' },
      ],
    });
    const link = `http://192.168.18.79:3990/pair#${fragment}`;
    expect(decode(link)).toBe(link);
  });

  test('the deep link a native shell registers', () => {
    const link = encodePairingPayload({
      v: 1,
      pairingId: 'pair-2',
      secret: 'x'.repeat(43),
      serverId: 'server-2',
      label: 'desk',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
      candidates: [{ kind: 'cloudflare', url: 'https://kabmo.example.com' }],
    });
    expect(decode(link)).toBe(link);
  });
});
