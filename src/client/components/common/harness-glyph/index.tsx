/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness mark beside a session's name, a tab, or a model row.
 *
 * Draws the agent's OWN brand mark (`brands.ts`), not a generic icon: "claude"
 * with a lucide asterisk is a guess where Anthropic publishes a mark, and a
 * session list is exactly where a reader recognises the vendor by shape.
 *
 * One component for the sidebar, the phone drawer, the composer's tab strip and
 * the model rows, for the reason `ProviderIconPlate` exists: a glyph drawn per
 * surface becomes three shapes at three sizes with three gaps, and the column of
 * titles stops lining up.
 *
 * Painted in `currentColor` with the plate and gradient stripped from the source
 * art — the palette is reserved for `--theme-error`, so harness identity is
 * carried by SHAPE. A full-colour logo per row would be the only chroma in the
 * densest list in the app.
 *
 * The glyph is decorative: the harness NAME is already in the wrapper's
 * `aria-label`, so a screen reader hears "claude" rather than the `title` of an
 * SVG node.
 */

import {
  HARNESS_BRAND_GLYPHS,
} from '@/client/components/common/harness-glyph/brands';
import {
  harnessBadgeLabel,
  harnessDescriptor,
} from '@/shared/lib/harness/catalog';

interface HarnessGlyphProps {
  /** The session's harness id (`omp-rpc`, `claude`, …). An unknown id renders
   *  nothing rather than a misleading generic mark. */
  harness: string | null | undefined;
  /** Glyph size in px. */
  size?: number;
  className?: string;
}

export function HarnessGlyph({ harness, size = 12, className = '' }: HarnessGlyphProps) {
  const descriptor = harnessDescriptor(harness);
  if (!descriptor) return null;
  const glyph = HARNESS_BRAND_GLYPHS[descriptor.glyph];
  if (!glyph) return null;
  const label = harnessBadgeLabel(harness);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center text-ink/55 ${className}`}
      aria-label={label}
      title={`Session runs on ${label}`}
      data-harness={descriptor.id}
      role="img"
      style={{ width: size, height: size }}
    >
      {/* The mark's own viewBox: omp's logo is 64x64 and the rest 24x24, so the
          box travels with the art instead of being assumed. */}
      <svg
        viewBox={glyph.viewBox}
        width={size}
        height={size}
        fill="currentColor"
        // The colour rule's key: under `<html data-icon-style="color">` this
        // paints from the harness brand table. Absent for a mark with no brand
        // hex, so the mode never invents a hue to fill a row.
        data-harness={descriptor.glyph}
        aria-hidden="true"
        focusable="false"
        // Inner markup only — the source files carry no colour of their own
        // because the generator stripped plates and gradients.
        dangerouslySetInnerHTML={{ __html: glyph.body }}
      />
    </span>
  );
}

/** Glyph size per surface, from one place so neighbouring rows never drift.
 *
 *  - `compact` — a desktop session row, where the mark sits in a 12px slot
 *    beside a 12px name and the row's height is already fixed by its density.
 *  - `touch` — a phone session row, one pixel larger for a finger.
 *  - `tab` — the composer's harness tab strip. Deliberately its OWN size: the
 *    strip is a primary control with three to five visible tabs, so a 12px mark
 *    read as smaller than the 12px label beside it at the same nominal size —
 *    the icon was drawn inside a 24px viewBox with padding, so equal numbers are
 *    not equal ink. Two pixels larger, and the label goes to 12px with it.
 */
export const HARNESS_GLYPH_SIZE = { compact: 12, touch: 13, tab: 14 } as const;
