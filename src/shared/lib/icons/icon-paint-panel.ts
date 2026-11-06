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

import { DEFAULT_ICON_HUE, ICON_HUE_PAINT, ICON_PAPER_ATTRIBUTE } from '@/shared/lib/icons/tint';
import type { PaperBucket } from '@/shared/lib/icons/icon-tone';

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
function panelPaint(variant: 'light' | 'dark', bucket: PaperBucket = 'deepest'): string {
  const { saturation, lightness } = ICON_HUE_PAINT[variant];
  const hsl = `hsl(var(--panel-hue, var(--icon-hue, ${DEFAULT_ICON_HUE})) ${saturation}% ${lightness}%)`;
  // Both variants read a `--panel-tone*` stamped by `PanelMark` from the solved
  // table: a panel's hue is assigned at runtime, so it cannot be a generated CSS
  // row, and an unsolved `hsl()` on the dark side is the lightness spread this
  // mode was fixed by removing. Light picks the bucket the palette is painting,
  // exactly like the generated glyph rows.
  const toned = variant === 'light' ? `var(--panel-tone${bucket === 'deepest' ? '' : `-${bucket}`}, ${hsl})` : `var(--panel-tone-dark, ${hsl})`;
  return `var(--panel-color-${variant}, ${toned})`;
}

export function panelMarkRules(): string[] {
  const light = panelPaint('light');
  const brighter = (['deeper', 'deep', 'mid', 'light', 'bright'] as const).map(
    (bucket) => [bucket, panelPaint('light', bucket)] as const,
  );
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
  // The two brighter buckets, stated AFTER the deep one at the same specificity,
  // so a `mid` or `bright` paper re-points the same mark the glyph rows use.
  // Without these a panel would keep the deepest table on every light palette —
  // the rail reading darker than the icons in the panels behind it.
  const bucketRule = (bucket: string, paint: string) =>
    `:root[data-icon-style="color"][${ICON_PAPER_ATTRIBUTE}="${bucket}"] [data-panel-mark]:not(.bg-ink *) svg.lucide { color: ${paint}; }`;
  const bucketPluginRule = (bucket: string, paint: string) =>
    `:root[data-icon-style="color"][${ICON_PAPER_ATTRIBUTE}="${bucket}"] [data-panel-mark] [data-plugin-mark] { --plugin-color: ${paint}; }`;
  return [
    `${scope} { color: ${light}; }`,
    ...brighter.map(([bucket, paint]) => bucketRule(bucket, paint)),
    `${scopeDark} { color: ${dark}; }`,
    // A plugin's mark states its own `--plugin-color` from its name; inside a
    // panel mark the panel's declared colour (or assigned hue) is the authority.
    `:root[data-icon-style="color"] [data-panel-mark] [data-plugin-mark] { --plugin-color: ${light}; }`,
    ...brighter.map(([bucket, paint]) => bucketPluginRule(bucket, paint)),
    `:root[data-icon-style="color"][data-theme-variant="dark"] [data-panel-mark] [data-plugin-mark] { --plugin-color: ${dark}; }`,
    // The idle state moves LUMINANCE, never alpha.
    //
    // It used to be `opacity: 0.45`, which composites the hue with the rail's
    // near-neutral chrome and therefore throws most of the chroma away: measured
    // on a 64px glyph, `hsl(170 65% 70%)` renders at chroma 95 when active and
    // **62** when idle, and the rail read as washed-out pastels — "warna icon di
    // activity panel kanan / kiri kok agak kusem". A `brightness()` shift plus
    // the `saturate()` that pays back what the multiply costs keeps the colour
    // and moves only the luminance — but it must not walk the mark UNDER the
    // floor, and it did: with the solved light tone sitting at 3.30:1 mean,
    // `brightness(1.08)` dropped the idle mark to **2.88:1 mean, 35 of 36 hues
    // below 3:1**. Measured over the same tones, `1.02` holds 3.18 mean with
    // every hue clear, so that is the light factor now.
    //
    // The two variants shift in opposite directions because "recede" does: on ink
    // an idle icon is DARKER, on paper it is LIGHTER. Dark has 6.97:1 of headroom
    // and spends more of it: `0.62` read 2.86 mean (20 hues below the floor)
    // while `0.75` reads 4.00 with none.
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
    '[data-icon-style="color"] [data-panel-mark][data-idle]:not([data-declared]) { filter: brightness(1.02) saturate(1.1); }',
    '[data-icon-style="color"][data-theme-variant="dark"] [data-panel-mark][data-idle]:not([data-declared]) { filter: brightness(0.75) saturate(1.4); }',
  ];
}
