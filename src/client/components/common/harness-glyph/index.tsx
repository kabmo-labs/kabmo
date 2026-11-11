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
  /**
   * Paint in the SURROUNDING `color` instead of the default muted ink.
   *
   * The default (`text-ink/55`) is right on paper, and invisible on an
   * inverted surface: `bg-ink` is the palette's foreground used as a fill, so
   * muted ink on it is nearly the same colour in one of the two themes. A badge
   * that fills `bg-ink` says `text-canvas` and passes this, so the mark takes
   * the badge's own foreground.
   */
  inherit?: boolean;
  /**
   * Draw the mark as DECORATION: no `title`, no `role="img"`, no `aria-label`.
   *
   * For a glyph that lives INSIDE a control which already names it. Two reasons,
   * both measured:
   *
   *  - a `title` on the innermost element is the one the browser shows, so the
   *    tab's own sentence ("this chat already started on omp") was replaced by
   *    this component's generic "Session runs on claude" — the tab looked
   *    uninformative while carrying a perfectly good explanation one level up;
   *  - a `role="img"` with a label inside a named `<button>` contributes nothing
   *    to the button's name and only adds a second thing to announce.
   */
  decorative?: boolean;
}

export function HarnessGlyph({ harness, size = 12, className = '', inherit = false, decorative = false }: HarnessGlyphProps) {
  const descriptor = harnessDescriptor(harness);
  if (!descriptor) return null;
  const glyph = HARNESS_BRAND_GLYPHS[descriptor.glyph];
  const label = harnessBadgeLabel(harness);
  // A user-added harness has no vendor mark. Its INITIAL is the honest stand-in:
  // a generic lucide shape would claim a brand, and rendering nothing left the
  // row's identity column blank.
  if (!glyph) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-[3px] border border-current/30 font-semibold leading-none ${inherit ? '' : 'text-ink/55'} ${className}`}
        aria-label={decorative ? undefined : label}
        title={decorative ? undefined : `Session runs on ${label}`}
        data-harness={descriptor.id}
        role={decorative ? undefined : 'img'}
        aria-hidden={decorative ? 'true' : undefined}
        style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.62)) }}
      >
        {descriptor.initial}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${inherit ? '' : 'text-ink/55'} ${className}`}
      aria-label={decorative ? undefined : label}
      title={decorative ? undefined : `Session runs on ${label}`}
      data-harness={descriptor.id}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      style={{ width: size, height: size }}
    >
      {/* Cropped to the INK, not to the source box. Every mark is drawn at the
          same `size`, and a viewport is not a mark: omp fills 62.5% of its 64x64
          box while codex fills all of 24x24, so at one nominal size the two drew
          as two different sizes (measured in the picker: 11px of omp ink beside
          18px of codex). `preserveAspectRatio` keeps each brand's own shape, so
          the crop normalises how LARGE a mark reads without distorting it. */}
      <svg
        viewBox={glyph.ink.join(' ')}
        width={size}
        height={size}
        fill="currentColor"
        // The colour rule's key: under `<html data-icon-style="color">` this
        // paints from the harness brand table. Absent for a mark with no brand
        // hex, so the mode never invents a hue to fill a row.
        data-harness={descriptor.glyph}
        // The HARNESS, not the brand. omp publishes one mark for two transports,
        // so the brand key cannot tell `omp-rpc` from `omp-acp` — and a tab that
        // is only a mark has no word left to do it. `harness/brand-color.ts`
        // keys its per-surface table on this.
        data-harness-id={descriptor.id}
        aria-hidden="true"
        focusable="false"
        // Inner markup only — the source files carry no colour of their own
        // because the generator stripped plates and gradients.
        dangerouslySetInnerHTML={{ __html: glyph.body }}
      />
    </span>
  );
}

/**
 * Glyph size per surface, from one place so neighbouring rows never drift.
 *
 * The number is the mark's own INK box, not a source viewport: `HarnessGlyph`
 * crops each brand to its measured `ink` and draws that at `size`, so 12 here is
 * 12px of mark for omp and codex alike (before the crop, an `18` was 11px of omp
 * ink beside 18px of codex and the strip looked uneven).
 *
 *  - `compact` — a desktop session row, where the mark sits in a 12px slot
 *    beside a 12px name and the row's height is already fixed by its density.
 *  - `touch` — a phone session row, one pixel larger for a finger.
 *  - `tab` — the composer's harness tab strip. Deliberately its OWN size: the
 *    strip is a primary control with three to five visible tabs, and the tab is
 *    the mark ALONE — no label beside it to carry the identity — so the mark is
 *    sized as a standalone control glyph rather than as a supplement to text.
 */
export const HARNESS_GLYPH_SIZE = { compact: 12, touch: 13, tab: 18 } as const;
