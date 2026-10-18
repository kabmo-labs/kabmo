/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The context-usage ring: a circle that fills clockwise with the share of the
 * window in use.
 *
 * Clockwise from twelve o'clock is a `-90deg` rotation, and it is written as the
 * SVG `transform` ATTRIBUTE rather than a Tailwind class: a CSS transform on an
 * SVG child resolves its origin against `transform-box`, whose default differs
 * between engines, so the same class can pivot around the box corner and draw
 * the arc starting at nine o'clock. The attribute names the centre explicitly.
 *
 * The stroke attributes are written KEBAB-CASE on purpose. Preact assigns a prop
 * whose name exists on the element as a DOM PROPERTY and otherwise calls
 * `setAttribute`, so `strokeDasharray` becomes a `strokeDasharray` attribute —
 * which no SVG renderer reads. Browsers happen to reflect the property, but the
 * markup (and any test or serialiser that reads the attribute) then carries a
 * spelling that does not exist.
 *
 * Colour is the band's, and the TRACK is deliberately neutral ink — a track in
 * the band colour made an empty ring look half full at a glance.
 */

import { CONTEXT_BAND_TONES, contextRingGeometry, contextUsageBand } from '@/shared/lib/chat/context/usage';

interface ContextRingProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
}

export function ContextRing({ percent, size = 18, strokeWidth = 2 }: ContextRingProps) {
  const { radius, circumference, dashOffset } = contextRingGeometry(percent, size, strokeWidth);
  const centre = size / 2;
  const band = contextUsageBand(percent);
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': strokeWidth,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        {...stroke}
        transform={`rotate(-90 ${centre} ${centre})`}
        className="text-ink/20"
      />
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        {...stroke}
        transform={`rotate(-90 ${centre} ${centre})`}
        stroke-linecap="round"
        stroke-dasharray={circumference}
        stroke-dashoffset={dashOffset}
        className={`${CONTEXT_BAND_TONES[band].text} transition-[stroke-dashoffset] duration-500 ease-out`}
      />
    </svg>
  );
}
