/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pairing QR as a file.
 *
 * The download hands the user the same drawing the dialog shows, not a
 * screenshot of it: the geometry (quiet zone, integer pixels per module) is
 * shared with `QrCode`, so a saved code scans exactly like the one on screen.
 * A PNG re-encode would resample module edges — the failure the on-screen
 * renderer already avoids by drawing whole pixels.
 */

import { saveBlob } from '@/client/lib/browser/download';
import type { QrMatrix } from '@/shared/lib/connect/types';

export const QUIET_ZONE = 4;

/**
 * The widest the code is drawn, in CSS pixels.
 *
 * A screenshot of this dialog is what a camera-less device uploads, so the size
 * is a functional choice, not a layout one: at 260 px a ~100-module code is under
 * 3 px per module, and `jsQR` failed to read a real capture of it ("no QR code
 * found") while the same code at 4 px per module decoded every time.
 */
export const TARGET_EDGE = 340;

export interface QrGeometry {
  span: number;
  modulePx: number;
  edge: number;
}

/**
 * The drawing's dimensions. `modulePx` is an INTEGER: a fractional size makes
 * the browser antialias every module edge, which is exactly what a binarizer
 * cannot read — and it is why the same code scanned from a phone camera but not
 * from a screenshot.
 */
export function qrGeometry(matrix: QrMatrix): QrGeometry {
  const span = matrix.size + QUIET_ZONE * 2;
  const modulePx = Math.max(3, Math.floor(TARGET_EDGE / span));
  return { span, modulePx, edge: span * modulePx };
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The QR as a standalone SVG document, quiet zone included. */
export function qrSvgMarkup(matrix: QrMatrix, label: string): string {
  const { span, edge } = qrGeometry(matrix);
  const rects: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    const line = matrix.rows[row] ?? '';
    for (let column = 0; column < matrix.size; column += 1) {
      if (line[column] !== '1') continue;
      rects.push(`<rect x="${column + QUIET_ZONE}" y="${row + QUIET_ZONE}" width="1" height="1"/>`);
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(label)}"`,
    ` viewBox="0 0 ${span} ${span}" width="${edge}" height="${edge}" shape-rendering="crispEdges">`,
    `<rect width="${span}" height="${span}" fill="#ffffff"/>`,
    `<g fill="#141310">${rects.join('')}</g>`,
    '</svg>',
  ].join('');
}

/** Hand the QR to the browser as a downloadable SVG named `name`. */
export function downloadQrSvg(matrix: QrMatrix, name: string, label: string): void {
  saveBlob(new Blob([qrSvgMarkup(matrix, label)], { type: 'image/svg+xml' }), name);
}
