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
 * ## The track has two weights, because it has two jobs
 *
 * An EMPTY ring carries no arc, so the track is the only thing that says the
 * control is there: it is the whole graphic and needs to clear WCAG's 3:1
 * non-text floor on its own. At `/20` it composited to `rgb(66, 71, 80)` on the
 * dark navbar's glass chrome — **1.39:1** — so on `one-dark-pro-soft` the
 * control disappeared entirely ("icon context di topnavbar gelap"). `/75` is
 * the first rung whose worst case clears 3:1 on every one of the 63 palettes
 * (3.02:1 on `solarized-light`, 3.89:1 on `solarized-dark`), and it is the rung
 * the checkbox ring already uses for the same reason.
 *
 * A FILLED ring is the opposite problem, and it is measured, not aesthetic:
 * `/75` sits at almost the same luminance as the arc's solved signal colour, so
 * the two halves merged — worst case **1.04:1** from the arc on light palettes
 * (`nightowl-light`) and **1.00:1** on dark (`rose-pine-dark`), which is the
 * reported "mode light terlalu gelap, context warna hijau ndak kelihatan". No
 * single rung can do both jobs: on `paper`, the ink range between the surface
 * and the green arc is too narrow for one value to clear 3:1 against both.
 *
 * So the weight follows the arc. While an arc is drawn the track steps back to
 * `/25`. The objective is the ARC's contrast, not the track's: the arc is the
 * information, the track is the ground it is read against, so the rung is the
 * lightest one that still reads as a ring. `/35` — the previous value — was
 * chosen to maximise the WORSE of (track vs paper, track vs arc), which kept
 * the track visible but left the arc at **2.31:1** on `paper`: the same
 * "terlalu gelap, hijau ndak kelihatan" report, one rung later. `/25` lifts the
 * arc to **2.98:1** on `paper` (worst light 2.58:1 on `flexoki-light`, worst
 * dark 2.21:1 on `fields-of-the-shire-dark`) while the track still reads as a
 * ring — 1.73:1 on `paper`, 1.38:1 worst case on `solarized-light`. `/20` buys
 * the arc another 0.37:1 but drops the track under 1.5:1 on 25 of the 63
 * palettes, which is a ring that looks like a floating arc.
 */

import { CONTEXT_BAND_TONES, contextRingGeometry, contextUsageBand } from '@/shared/lib/chat/context/usage';

/** The track while nothing is filled in: the ring IS the control. */
const EMPTY_TRACK = 'text-ink/75';

/** The track under an arc: quiet enough that the band colour stays the signal. */
const FILLED_TRACK = 'text-ink/25';

/**
 * The dial is drawn on lucide's own 24-unit grid, at lucide's 2-unit stroke, so
 * it reads as a glyph beside the row's other icons.
 *
 * It used to be an 18px box scaled 1:1 — a full-bleed circle of 16 ink px with a
 * 2px CSS stroke, against a lucide glyph that inks 18 of its 24 units and
 * therefore draws 12 ink px at 1.33px in the same 16px box. Measured on the
 * running navbar: the ring's ink was 16x16 CSS against 12x12, and its stroke was
 * 50% heavier, which is the reported "icon context usage lebih besar dari icon
 * di sebelahnya". Matching the grid is what fixes both halves at once, at any
 * glyph size.
 */
const VIEW = 24;
/** Outer diameter in viewBox units: 20 inked at a 2-unit stroke reads as 18–20. */
const OUTER = 20;
const STROKE = 2;

interface ContextRingProps {
  percent: number;
  /** CSS box the 24-unit grid is scaled into; the row's own glyph size. */
  size?: number;
}

export function ContextRing({ percent, size = 16 }: ContextRingProps) {
  const { radius, circumference, dashOffset } = contextRingGeometry(percent, OUTER, STROKE);
  const centre = VIEW / 2;
  const band = contextUsageBand(percent);
  // The threshold is GEOMETRIC, not a guessed percentage: an arc shorter than
  // its own stroke width is a round-capped dot, not a share you can read, so
  // below that the ring still takes the heavier track (a 2% arc on a 20-unit
  // dial is a single unit of colour, and the control would read as missing
  // again).
  const filled = circumference - dashOffset >= STROKE;
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': STROKE,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      aria-hidden="true"
    >
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        {...stroke}
        transform={`rotate(-90 ${centre} ${centre})`}
        className={filled ? FILLED_TRACK : EMPTY_TRACK}
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
