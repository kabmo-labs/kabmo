/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The six colours a NATIVE shell paints its launch overlay with, projected from
 * a catalog palette.
 *
 * The overlay cannot read CSS: it is drawn before the page exists (that is the
 * whole point — the page's own bundle is what would report a colour), and it is
 * drawn by Kotlin, Swift, C# and Rust. So the palette has to cross the boundary
 * as VALUES, and this module is the one place they are derived.
 *
 * ## Why the page publishes it instead of the shell computing it
 *
 * The shells have no copy of the theme catalog and must not grow one: 45
 * palettes, re-typed in four languages, is four things to keep in step with
 * `palettes/*.ts`. The page already knows the active id, so it answers
 * `window.__kabmoPalette()` and each shell persists the answer for the NEXT cold
 * start — the one launch where no page is running yet to ask.
 *
 * ## Why `canvas` and not `paper`
 *
 * The page's own ground is `--theme-canvas` (`body` in `tailwind.css`), so an
 * overlay painted with `paper` hands the user a step one shade lighter at the
 * exact moment the console paints. The shells shipped `#FAF8F3` — the paper of
 * the default light palette — which is a double mismatch on a dark theme: wrong
 * shade AND wrong side of the light/dark split.
 *
 * `muted` and `hairline` mirror the two derived variables the document already
 * declares (`--ink-secondary`, `--ink-hairline`), which are `color-mix` over the
 * surface rather than palette slots.
 */

import type { ThemePalette } from '@/shared/types/theme';
import { mixHex, parseHexColor, rgbaToHex } from '@/shared/lib/theme/color';
import { resolveTheme } from '@/shared/lib/theme/catalog';

/** The colours a shell needs, as literal hex — no `color-mix`, no CSS. */
export interface ShellPalette {
  /** Which side of the light/dark split, for a shell that also themes chrome. */
  variant: 'light' | 'dark';
  /** The page's own ground: what the overlay and the web view paint. */
  canvas: string;
  /** A raised surface: an outlined button's fill. */
  paper: string;
  /** Foreground text, and the progress bar's fill. */
  ink: string;
  /** Secondary text — the overlay's status line (`--ink-secondary`). */
  muted: string;
  /** The bar's trough and a button's border (`--ink-hairline`). */
  hairline: string;
  /** The failure sentence's colour. */
  error: string;
}

/** The property the page installs. Named once so both sides agree. */
export const SHELL_PALETTE_PROPERTY = '__kabmoPalette';

/**
 * The projection, from a palette the catalog already resolved.
 *
 * Both mixes composite over `canvas`, which is the surface they are drawn on:
 * `color-mix(in srgb, ink 62%, transparent)` over `canvas` IS
 * `mixHex(canvas, ink, 0.62)`.
 *
 * Every slot is normalized to SIX-digit hex. The ported palettes are not
 * uniform — `jetbrains-light` carries `#FFF` — and four shell parsers reading
 * that as a shell colour is four places to get it wrong. One shape, stated here.
 */
export function shellPaletteFor(palette: ThemePalette): ShellPalette {
  return {
    variant: palette.variant,
    canvas: hex(palette.canvas),
    paper: hex(palette.paper),
    ink: hex(palette.ink),
    muted: mixHex(palette.canvas, palette.ink, 0.62),
    hairline: mixHex(palette.canvas, palette.ink, 0.14),
    error: hex(palette.error),
  };
}

/** `#rgb` / `#rrggbb` / `#rrggbbaa` as `#rrggbb`, or the input when unparseable. */
function hex(value: string): string {
  const parsed = parseHexColor(value);
  return parsed ? rgbaToHex(parsed) : value;
}

/** The projection for a stored theme id, through the catalog's own resolution. */
export function shellPalette(themeId: string | undefined | null): ShellPalette {
  return shellPaletteFor(resolveTheme(themeId));
}

/**
 * The shipped light palette's projection.
 *
 * What a shell paints on its FIRST launch, before any page has answered. Kept
 * here so the five shells' defaults are this module's numbers rather than five
 * hand-typed copies of `#FAF8F3`.
 */
export const DEFAULT_SHELL_PALETTE: ShellPalette = shellPaletteFor(resolveTheme(null));

/**
 * The wire form: `variant|canvas|paper|ink|muted|hairline|error`.
 *
 * A pipe-separated line rather than JSON because four native parsers read it
 * and only three of them can parse JSON: Android's `org.json` is a stub in a
 * JVM unit test (`not mocked`), so a JSON wire would leave the one parser that
 * most needs a test as the one that cannot have one. Seven fields, one
 * separator, and every value is `#rrggbb` — nothing to escape, nothing to
 * quote.
 */
export function shellPaletteWire(palette: ShellPalette): string {
  return [
    palette.variant,
    palette.canvas,
    palette.paper,
    palette.ink,
    palette.muted,
    palette.hairline,
    palette.error,
  ].join('|');
}

const WIRE_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The inverse, for a caller that already has the string (a stored preference, a
 * shell's test suite). `null` for anything that is not exactly seven fields —
 * a shell must fall back to its stored palette rather than paint `undefined`.
 */
export function parseShellPaletteWire(wire: string | null | undefined): ShellPalette | null {
  if (typeof wire !== 'string') return null;
  const parts = wire.split('|');
  if (parts.length !== 7) return null;
  const [variant, canvas, paper, ink, muted, hairline, error] = parts;
  if (variant !== 'light' && variant !== 'dark') return null;
  const colors = [canvas, paper, ink, muted, hairline, error];
  if (!colors.every((value) => WIRE_COLOR.test(value))) return null;
  return { variant, canvas, paper, ink, muted, hairline, error };
}
