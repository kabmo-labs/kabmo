/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pairing QR as a PNG.
 *
 * Two properties decide whether a downloaded file is usable, and neither is
 * visible in an assertion about "a file was produced":
 *
 * - **It is a real PNG.** The first attempt handed the user an SVG, which most
 *   image viewers refuse to open — the button looked like it worked and the file
 *   was unreadable.
 * - **It still decodes.** The pixels are read back from the encoded bytes (IHDR,
 *   the inflate of IDAT, the packed 1-bit rows) and fed to the same `jsQR` the
 *   login screen uses. That is the decoder the scan path runs, not a restatement
 *   of the encoder.
 */

import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import jsQR from 'jsqr';
import { qrPng } from '@/server/lib/connect/qr-png.server';
import { qrMatrix } from '@/server/lib/connect/qr.server';

const PAYLOAD = 'https://kabmo.example/pair#eyJwYWlyaW5nSWQiOiJhYmMifQ';

/** Read the encoded PNG back into RGBA, the way an image viewer would. */
function pixelsOf(png: Uint8Array): { data: Uint8ClampedArray; width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= png.byteLength) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      expect(data[8]).toBe(1); // bit depth
      expect(data[9]).toBe(0); // greyscale
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }

  const rowBytes = Math.ceil(width / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const start = y * (rowBytes + 1);
    expect(raw[start]).toBe(0); // filter: none
    for (let x = 0; x < width; x += 1) {
      const dark = (raw[start + 1 + (x >> 3)]! & (0x80 >> (x & 7))) === 0;
      const value = dark ? 0 : 255;
      const index = (y * width + x) * 4;
      rgba[index] = value;
      rgba[index + 1] = value;
      rgba[index + 2] = value;
      rgba[index + 3] = 255;
    }
  }
  return { data: rgba, width, height };
}

describe('pairing QR PNG', () => {
  test('is a PNG whose pixels still decode to the payload', () => {
    const matrix = qrMatrix(PAYLOAD);
    const png = qrPng(matrix);

    // The signature is what a viewer sniffs; a viewer that refuses the file says
    // nothing about the pixels, so this is checked before decoding.
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const { data, width, height } = pixelsOf(png);
    // Four modules of quiet zone on each side, ten pixels per module.
    expect(width).toBe((matrix.size + 8) * 10);
    expect(height).toBe(width);
    expect(jsQR(data, width, height)?.data).toBe(PAYLOAD);
  });

  test('keeps a quiet zone, which is what a scanner needs to find the code at all', () => {
    const png = qrPng(qrMatrix(PAYLOAD));
    const { data, width } = pixelsOf(png);
    // The first module starts at 40 px; the border must still be paper.
    for (let x = 0; x < 40; x += 1) {
      expect(data[(10 * width + x) * 4]).toBe(255);
    }
  });
});
