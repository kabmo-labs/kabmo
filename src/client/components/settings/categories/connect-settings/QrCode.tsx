/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pairing QR, drawn from the server's module matrix.
 *
 * A matrix rather than an SVG string from the server: the payload is a deep link
 * carrying a one-time secret, and injecting server-built markup to render it is
 * the shortcut that turns a QR renderer into an injection point. Here the only
 * thing that reaches the DOM is a `<rect>` per dark module.
 *
 * The quiet zone is part of the drawing, not padding on the container: a scanner
 * needs four modules of margin, and a CSS padding that a theme or a layout rule
 * can shrink is a code that scans on one screen and not another.
 */

import type { JSX } from 'preact';
import { QUIET_ZONE, qrGeometry } from '@/client/components/settings/categories/connect-settings/qr-image';
import type { QrMatrix } from '@/shared/lib/connect/types';

export function QrCode({ matrix, label }: { matrix: QrMatrix; label: string }) {
  const { span, edge } = qrGeometry(matrix);
  const rects: JSX.Element[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    const line = matrix.rows[row] ?? '';
    for (let column = 0; column < matrix.size; column += 1) {
      if (line[column] !== '1') continue;
      rects.push(
        <rect
          key={`${row}:${column}`}
          x={column + QUIET_ZONE}
          y={row + QUIET_ZONE}
          width={1}
          height={1}
        />,
      );
    }
  }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${span} ${span}`}
      width={edge}
      height={edge}
      className="block h-auto max-w-full rounded-lg bg-white"
      shape-rendering="crispEdges"
    >
      <rect x={0} y={0} width={span} height={span} fill="#ffffff" />
      <g fill="#141310">{rects}</g>
    </svg>
  );
}
