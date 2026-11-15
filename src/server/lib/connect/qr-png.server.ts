/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pairing QR as a PNG the user can open anywhere.
 *
 * The browser draws the code from the same matrix, but a SAVED code has to
 * survive leaving the page: an SVG is unreadable to most image viewers and
 * preview panes, so the file handed to the operating system is a raster PNG at
 * an integer number of pixels per module. PNG is lossless, so the saved pixels
 * are exactly the drawn ones — no resampling of module edges, which is what a
 * binarizer cannot read.
 *
 * Written by hand rather than through an image library: the server already has
 * the module matrix, and the encoding is a signature, three chunks and a zlib
 * stream. `Bun.Image` can only START from an encoded image, so it would need a
 * second format (a BMP) as an intermediate — two encoders for one picture.
 */

import { deflateSync } from 'node:zlib';
import type { QrMatrix } from '@/shared/lib/connect/types';

/** Four modules of margin, which is what a scanner requires. */
const QUIET_ZONE = 4;

/**
 * Pixels per module in the saved file.
 *
 * A code shown on screen needs ~4 px per module for a camera to read it
 * (`jsQR` failed on 3 px captures); a FILE is often uploaded from a device with
 * no camera, so the margin is doubled — a larger file cannot be too small to
 * scan.
 */
const MODULE_PX = 10;

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A 1-bit greyscale PNG: white paper, black modules.
 *
 * 1 bit per pixel, not 8: the image is two colours, the packing keeps the file
 * a few kilobytes, and nothing between here and the scanner resamples it.
 */
export function qrPng(matrix: QrMatrix): Uint8Array<ArrayBuffer> {
  const span = matrix.size + QUIET_ZONE * 2;
  const edge = span * MODULE_PX;
  const rowBytes = Math.ceil(edge / 8);
  // One filter byte per scanline, then the packed pixels.
  const raw = new Uint8Array((rowBytes + 1) * edge);
  for (let y = 0; y < edge; y += 1) {
    const start = y * (rowBytes + 1);
    raw[start] = 0; // filter: none
    raw.fill(0xff, start + 1, start + 1 + rowBytes); // paper
  }

  for (let row = 0; row < matrix.size; row += 1) {
    const line = matrix.rows[row] ?? '';
    for (let column = 0; column < matrix.size; column += 1) {
      if (line[column] !== '1') continue;
      const top = (row + QUIET_ZONE) * MODULE_PX;
      const left = (column + QUIET_ZONE) * MODULE_PX;
      for (let y = top; y < top + MODULE_PX; y += 1) {
        const offset = y * (rowBytes + 1) + 1;
        for (let x = left; x < left + MODULE_PX; x += 1) {
          raw[offset + (x >> 3)]! &= ~(0x80 >> (x & 7));
        }
      }
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, edge);
  view.setUint32(4, edge);
  header[8] = 1; // bit depth
  header[9] = 0; // colour type: greyscale
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter method: adaptive
  header[12] = 0; // interlace: none

  const parts = [SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
