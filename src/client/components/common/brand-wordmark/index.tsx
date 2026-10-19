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
 * - **`K`** takes the icon's own accent (`--color-brand`, the orange of the
 *   logo's upper arm). It is the letter that carries the mark, so it uses the
 *   mark's colour exactly — a themed token here would make the K change hue
 *   with the palette while the icon never does.
 * - **`ab`** keeps the gradient the previous wordmark used for its leading run
 *   (`orange-600 → amber-500`), so the word still reads as a continuation of the
 *   product it was renamed from.
 * - **`mo`** is plain surface ink, the colour the trailing run has always had.
 *   Ink is what keeps that run legible on every palette, dark ones included.
 *
 * `className` carries the SIZE (each surface sets its own) and nothing else: the
 * colour split and the tracking are the brand and are not a per-call-site
 * decision.
 */
export function BrandWordmark({ className = 'text-[15px]' }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tighter ${className}`}>
      <span className="text-brand">K</span>
      <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-amber-500">ab</span>
      <span className="text-ink">mo</span>
    </span>
  );
}
