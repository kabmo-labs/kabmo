/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The QR matrix, as rows of `0`/`1`.
 *
 * A matrix rather than an SVG string: the client draws `<rect>`s from it, so the
 * pairing dialog never injects server-produced markup into the page. The payload
 * is a deep link carrying a one-time secret, and `dangerouslySetInnerHTML` on a
 * string built from it is exactly the kind of shortcut that turns a QR renderer
 * into an injection point.
 *
 * Error correction is `M` (~15%): the code is shown on a screen and scanned at
 * arm's length, so a little tolerance is worth the extra modules.
 */

import qrcode from 'qrcode-generator';
import type { QrMatrix } from '@/shared/lib/connect/types';

export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const rows: string[] = [];
  for (let row = 0; row < size; row += 1) {
    let line = '';
    for (let column = 0; column < size; column += 1) {
      line += qr.isDark(row, column) ? '1' : '0';
    }
    rows.push(line);
  }
  return { size, rows };
}
