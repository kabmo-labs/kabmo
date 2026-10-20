/**
 * The product wordmark, in one place.
 *
 * Six surfaces draw it — the desktop sidebar header, the desktop top navbar,
 * both phone headers, the login screen and the About dialog — and each used to
 * spell the brand itself. They drifted in size and in class order, which is the
 * sort of difference nobody notices until the same name looks like two
 * different products on two layouts.
 *
 * The word is drawn in three runs, each with its own colour, and the split is
 * deliberate rather than decorative:
 *
 * - **`K`** is the icon's mark, not a letter: `BrandMark` draws the logo's three
 *   strokes (ink stem and lower arm, `--color-brand` upper arm) so the word
 *   begins with the same shape the app icon and the favicon carry.
 * - **`ab`** keeps the previous wordmark's gradient (`amber-500 → orange-600`),
 *   run from light to dark so the brightest end sits against the icon's dark
 *   green plate: the `a` is tucked into that plate, and a dark `a` on dark green
 *   is the one place the lockup would lose a letter. The warm end still lands
 *   where the word returns to ink.
 * - **`mo`** is plain surface ink, the colour the trailing run has always had.
 *   Ink is what keeps that run legible on every palette, dark ones included.
 *
 * Two measurements are encoded in the render, and both fix a letter that was
 * being cut rather than merely crowded:
 *
 * - **`ab` carries a right padding of `0.06em` and an equal negative margin.**
 *   `background-clip: text` clips the gradient to the span's box, and the `b`'s
 *   right sidebearing is NEGATIVE — the glyph's ink ends past its advance — so
 *   the last 2-3 px of the `b` were clipped away at 15px and the letter read as
 *   if `m` were covering it. Measured on the live wordmark at 4x: the span's box
 *   ended 0.5px past the `b`'s ink with the clip and 3px past it once padded, so
 *   the padding pays for the overhang and the negative margin cancels it from
 *   the layout. A tracked-out `tracking-tight` (`-0.025em`) was part of the same
 *   crowding: at `-0.05em` the ink gap between `b` and `m` measured 0.017em.
 * - **`mo` carries `margin-left: 0.02em`.** With the tracking loosened, `a`→`b`
 *   measures 0.063em of ink gap while `b`→`m` measures 0.043em — the pair reads
 *   tight because `m`'s left stem is a full vertical beside `b`'s bowl. The
 *   margin brings the second gap to 0.063em, the same as the first, and leaves
 *   `m`→`o` (0.042em, the font's own spacing) alone.
 *
 * `className` carries the SIZE (each surface sets its own) and nothing else: the
 * colour split and the tracking are the brand and are not a per-call-site
 * decision.
 */
import { BrandMark } from '@/client/components/common/brand-wordmark/Mark';

export function BrandWordmark({ className = 'text-[15px]' }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight ${className}`}>
      <BrandMark />
      <span className="sr-only">K</span>
      <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-orange-600" style={{ paddingRight: '0.06em', marginRight: '-0.06em' }}>ab</span>
      <span className="text-ink" style={{ marginLeft: '0.02em' }}>mo</span>
    </span>
  );
}
