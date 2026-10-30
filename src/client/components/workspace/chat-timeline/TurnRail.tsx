/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `trace` rail for ONE turn, drawn by the turn rather than by each block.
 *
 * The first shape gave every block (thinking, the tool section, a notice) its
 * own segment sized to that block. Measured on the 39-call sample session in the
 * browser, that produced three disconnected lines with real gaps between them:
 *
 *   thinking      -1390 → -1356   (34px)
 *   gap            256px          ← the answer text in between
 *   tool section  -1100 →  368    (1468px)
 *   gap             99px
 *   notice          467 →  512    (45px)
 *
 * A rail whose whole job is to say "these steps are one sequence" cannot break
 * wherever prose happens to sit between them, so the line belongs to the
 * container that holds them all and each block only places its NODE on it.
 *
 * The horizontal origin is the blocks' own gutter: every block is inset by
 * `transcriptGutter` (12px on desktop, 0 on a phone) and puts its node at its
 * own `left-0`, so the rail sits at `gutter + 3.5px` — measured `rail 315 /
 * node 315` for thinking, a notice and a tool row alike.
 *
 * Rendered only when the turn actually has a trace block; a line drawn beside a
 * plain answer would claim a sequence that is not there.
 */

interface TurnRailProps {
  /** The turn has at least one block that draws a node. */
  visible: boolean;
  isMobile: boolean;
}

export function TurnRail({ visible, isMobile }: TurnRailProps) {
  if (!visible) return null;
  return (
    <span
      aria-hidden="true"
      data-turn-rail
      // The line spans the run, so it starts a little above the first node and
      // ends a little below the last (the row's own margin plus the node's 9px
      // offset — measured 21px / 32px). Both ends taper, so the rail reads as the
      // run's column rather than a bar with cut ends.
      //
      // The taper is an INLINE style, not `[mask-image:…]`: an arbitrary-value
      // class only exists if the CSS generator emitted that exact string, and
      // measured in the browser the computed `mask-image` was `none` — the class
      // was in the bundle but the dev asset serving the page had not been
      // regenerated, which is the silent failure mode the wiki records for
      // arbitrary classes (a missing rule fails without an error).
      style={{
        maskImage: 'linear-gradient(to bottom, transparent 0, black 10px, black calc(100% - 10px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 10px, black calc(100% - 10px), transparent 100%)',
      }}
      className={`pointer-events-none absolute top-0 bottom-0 w-px bg-ink/15 ${
        isMobile ? 'left-[3.5px]' : 'left-[15.5px]'
      }`}
    />
  );
}
