/**
 * The `K` of the wordmark: the app icon itself.
 *
 * The wordmark used to spell its leading letter in the UI font and colour it
 * orange, which made the K a coloured character rather than the brand mark.
 * This is `public/icon.svg` — the same rounded green tile, the same three
 * strokes at the same 7/64 weight, the same orange upper arm — drawn inline so
 * the word starts with the logo.
 *
 * **The tile is sized to the cap band, not to the line box.** The icon's ink is
 * 41 of its 64 units tall (0.64), so a tile of `1.5625 × cap` puts the K's own
 * height exactly on the cap height — the letter does not shrink when it gains
 * its plate. That makes the plate taller than the cap band, and a plate whose
 * bottom sits on the baseline would lift the K half that difference; the
 * `vertical-align` below shifts the whole box down by the overhang so the ink's
 * bottom lands on the baseline and its top on the cap line. Both numbers are
 * derived from the same two constants (`1.5625 = 1 / 0.64`, overhang
 * `(1.5625 − 1) / 2`), so they cannot drift apart.
 *
 * Both are expressed in `cap`, which is the font's own cap height — the mark
 * then aligns on every face the stack resolves to, and not just on the one this
 * was measured against. `0.7046em` is that cap height on the current stack
 * (10.5688px at 15px, 11.2734 at 16, 16.9102 at 24 — 0.70459 each) and the
 * class carries it as the fallback for engines without the unit; an unsupported
 * inline declaration is dropped, so the class applies there.
 *
 * `inline-block` is not decoration: Tailwind's preflight makes every `svg`
 * `display: block`, and a block box inside the wordmark's inline flow breaks the
 * word onto its own line.
 *
 * **The `a` is tucked into the plate by `0.28em` of negative right margin**, so
 * the word reads as a lockup rather than a plate with a word after it. The limit
 * is the icon's lower arm, which ends 2.1px inside the plate at 15px: measured
 * at five depths, `-0.20em` left 2.12px of clearance to that stroke and
 * `-0.28em` leaves 0.93px — the deepest value that still keeps the letter off
 * the arm's round cap, while putting its ink 3.8px inside a 16.5px plate.
 *
 * The tile and cream are `--color-brand-tile` / `--color-brand-cream`, not theme
 * tokens: the icon is the same mark in every palette, and on a dark canvas a
 * themed plate would be a hole rather than a plate. They are set as inline
 * `style` declarations rather than presentation attributes, because a `var()`
 * in a presentation attribute is not resolved (measured: the rect computed to
 * black and the stem to `none`).
 */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={`inline-block h-[1.1009em] w-auto flex-none [vertical-align:-0.1982em] ${className}`}
      style={{ height: '1.5625cap', verticalAlign: '-0.28125cap', marginRight: '-0.28em' }}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="14" style={{ fill: 'var(--color-brand-tile)' }} />
      <g fill="none" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 15v34" style={{ stroke: 'var(--color-brand-cream)' }} />
        <path d="M20 32 42 15" style={{ stroke: 'var(--color-brand)' }} />
        <path d="M20 32 42 49" style={{ stroke: 'var(--color-brand-cream)' }} />
      </g>
    </svg>
  );
}
