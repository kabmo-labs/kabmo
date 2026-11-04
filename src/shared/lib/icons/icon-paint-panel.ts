/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The paint for a PANEL's mark — the one colour a panel has, on every surface.
 *
 * Split out of `icon-paint-css.ts` so both files stay readable, not because the
 * rules are independent: they are one of the families that sheet concatenates.
 *
 * These are the ONE place a paint rule may outrank an author class, and it is
 * deliberate: a surface expresses a panel's STATE with a weight (`text-ink/70` →
 * `text-ink/30`), which is a colour — so a zero-specificity hue rule lost and the
 * right rail stayed monochrome while every glyph in the panels behind it was
 * tinted ("icon panel right harus punya warna sendiri"). The state moves to
 * `data-idle` here, which reads the same in the monochrome mode that has no hue
 * to dim, and the colour comes from the mode.
 */

import { DEFAULT_ICON_HUE, ICON_HUE_PAINT } from '@/shared/lib/icons/tint';

/**
 * Three sources, in this order: the colour a PLUGIN DECLARED in its manifest
 * (`--panel-color`), then the hue assigned to the PANEL (`--panel-hue`), then the
 * glyph's own generated hue.
 *
 * A declared colour arrives as TWO values (`--panel-color-light` /
 * `--panel-color-dark`), because a brand hex is legible on one variant and not
 * the other: `#34d399` is 1.9:1 on white paper. The component clamps it with the
 * same `legiblePair` rule the brand tables use, so the plugin's colour reaches
 * the mark without dropping it below the floor.
 */
function panelPaint(variant: 'light' | 'dark'): string {
  const { saturation, lightness } = ICON_HUE_PAINT[variant];
  const hsl = `hsl(var(--panel-hue, var(--icon-hue, ${DEFAULT_ICON_HUE})) ${saturation}% ${lightness}%)`;
  // Light reads `--panel-tone`, the same solved table the glyph rows use: a
  // panel's hue is assigned at runtime, so the tone is stamped by `PanelMark`
  // rather than generated per row. Dark keeps the single `hsl()` pair.
  const toned = variant === 'light' ? `var(--panel-tone, ${hsl})` : hsl;
  return `var(--panel-color-${variant}, ${toned})`;
}

export function panelMarkRules(): string[] {
  const light = panelPaint('light');
  const dark = panelPaint('dark');
  // `[data-panel-mark]`, not `.panel-rail-mark`: the rail is not the only surface
  // that draws a panel, and it used to be the only one that got the PANEL's
  // colour. The phone's chip strip and Settings' Built-in list drew the bare
  // glyph and took the GLYPH's hue instead — measured, `Files` was `hsl(0 …)` on
  // the rail and `hsl(320 …)` in Settings, and `Wiki`'s `BookOpen` fell through
  // to the `info` signal because it means something as a glyph but nothing as a
  // panel. Every one of them now stamps the same `--panel-hue` (see
  // `client/components/common/panel-mark`), so the surface a mark appears on
  // cannot change what colour it is.
  //
  // `:root` is stated to beat `inkWeightRules` on SPECIFICITY rather than on
  // source order: a surface writes `text-ink/70`/`text-ink/30` to say whether a
  // panel is active, and the weight rule is (0,3,1) light / (0,4,1) dark — a tie
  // this block would only win by coming later.
  //
  // `:not(.bg-ink *)` because a phone chip goes inverted when active: the hue is
  // tuned for paper, and the chip already declares its own foreground.
  const scope = `:root[data-icon-style="color"] [data-panel-mark]:not(.bg-ink *) svg.lucide`;
  const scopeDark = `:root[data-icon-style="color"][data-theme-variant="dark"] [data-panel-mark]:not(.bg-ink *) svg.lucide`;
  return [
    `${scope} { color: ${light}; }`,
    `${scopeDark} { color: ${dark}; }`,
    // A plugin's mark states its own `--plugin-color` from its name; inside a
    // panel mark the panel's declared colour (or assigned hue) is the authority.
    `:root[data-icon-style="color"] [data-panel-mark] [data-plugin-mark] { --plugin-color: ${light}; }`,
    `:root[data-icon-style="color"][data-theme-variant="dark"] [data-panel-mark] [data-plugin-mark] { --plugin-color: ${dark}; }`,
    // The idle state moves LUMINANCE, never alpha.
    //
    // It used to be `opacity: 0.45`, which composites the hue with the rail's
    // near-neutral chrome and therefore throws most of the chroma away: measured
    // on a 64px glyph, `hsl(170 65% 70%)` renders at chroma 95 when active and
    // **62** when idle, and the rail read as washed-out pastels — "warna icon di
    // activity panel kanan / kiri kok agak kusem". A `brightness()` shift plus
    // the `saturate()` that pays back what the multiply costs keeps the colour
    // and moves only the luminance: the same glyph measures **94** chroma at
    // contrast 3.07 instead of 62 at 2.94, i.e. the SAME quietness with the
    // colour restored.
    //
    // The two variants shift in opposite directions because "recede" does: on ink
    // an idle icon is DARKER, on paper it is LIGHTER.
    //
    // Light's factor is `1.08 saturate(1.1)`, NOT the `1.25` the darker paint
    // needed. The light tone is now a solved hex sitting AT the contrast floor
    // (3.15 mean 3.30, `icon-tone.ts`), where the old pair had 6.11 of headroom to
    // spend — so the old factor walked every idle mark down to 2.23:1 and the rail
    // went dim rather than quiet. Re-measured over the shipped tones: `1.08/1.1`
    // reads 2.79:1 mean, still a visible step down, and holds chroma at 111% of
    // the active mark (the `saturate()` is what pays for the multiply).
    //
    // A DECLARED brand colour is NOT dimmed. The settings card draws the same
    // plugin at full strength, so dimming this copy made one brand two colours
    // depending on where you looked ("warna icon plugins di setting modal dan di
    // activity bar beda"). The hue is the plugin author's, not ours to mute; the
    // rail's idle state still reads, because it is carried by the BUTTON
    // (background and active border), which no filter touches.
    //
    // `[data-declared]` is stamped from `panel.color` — a property, not a
    // class-name or inline-style guess, so this cannot drift when the mark
    // changes how it carries its colour.
    '[data-icon-style="color"] [data-panel-mark][data-idle]:not([data-declared]) { filter: brightness(1.08) saturate(1.1); }',
    '[data-icon-style="color"][data-theme-variant="dark"] [data-panel-mark][data-idle]:not([data-declared]) { filter: brightness(0.62) saturate(1.4); }',
  ];
}
