/**
 * @license
 * SPDX-License-Identifier: MIT
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
 *
 * The track is `/75`, not `/20`, and that is a measured floor. At `/20` the
 * stroke composited to `rgb(66, 71, 80)` on the dark navbar's glass chrome —
 * **1.39:1**, against WCAG's 3:1 non-text floor — so on `one-dark-pro-soft` the
 * whole control disappeared until the run was under way (the reported "icon
 * context di topnavbar gelap"). `/75` is the first rung of the ink ladder whose
 * worst case clears 3:1 on every one of the 63 palettes (3.02:1 on
 * `solarized-light`, 3.89:1 on `solarized-dark`), and it is the same rung the
 * checkbox ring already uses for exactly this reason (`tailwind.css`).
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
        className="text-ink/75"
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
