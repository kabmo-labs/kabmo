/** The muted ink ladder, plus the one step that clears AA. */

import type { ThemePalette } from '@/shared/types/theme';
import { mixHex, parseHexColor, relativeLuminance } from '@/shared/lib/theme/color';

/** The fifteen steps, lightest first. The number IS the percentage of ink, so
 *  `text-ink/40` and `--theme-ink-40` cannot mean different things. */
export const MUTED_STEPS = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90] as const;

/** The lightest step that clears AA on the default palette: `/65` at 5.31:1.
 *  `/60` is 4.46:1, so the boundary sits where it is needed, not safely above it. */
export const TEXT_CONTRAST_FLOOR = 65;

/**
 * Strength of the inline-code chip's fill, as a percentage of ink over paper.
 *
 * The chip is SOLVED, not an alpha: `color-mix(… 8%, transparent)` composites
 * with whatever is painted behind the chip, so a hovered block's tint showed
 * through it and the code changed colour mid-hover (measured on a real session
 * in the browser: the same `/Applications/Obsidian.app` chip read `#e4e9ed` at
 * rest and `#dce2e5` with the hover tint behind it). An opaque value also pins
 * the contrast between the code and its chip, which an alpha cannot.
 */
export const CODE_FILL_PERCENT = 8;

/** AA for small text. Named so the floor above can be read as a contrast. */
export const MUTED_CONTRAST_FLOOR = 4.5;

/** Step of the mix search: fine enough that the solver lands on the target. */
const MIX_STEP = 0.005;

/** WCAG contrast between two hex colours. */
export function contrastBetween(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** The contrast a text colour reaches on the WORSE of the two surfaces. */
export function worstTextContrast(color: string, palette: ThemePalette): number {
  const worst = Math.min(
    contrastBetween(color, palette.paper),
    contrastBetween(color, palette.canvas),
  );
  return Number.isFinite(worst) ? worst : 0;
}

export interface InkScale {
  /** Full-strength ink: the palette's own `ink`. */
  ink: string;
  /** The fifteen steps, lightest first. Each is the ink at that percentage. */
  ladder: readonly string[];
  /** The lightest step that clears AA on both surfaces; the OS shells read it. */
  muted: string;
  /** The inline-code chip's fill: opaque ink over this palette's paper. */
  codeFill: string;
}

/** Cached per palette object, so a render pass costs no arithmetic. */
const cache = new WeakMap<ThemePalette, InkScale>();

/** Not `color-mix`: the OS shells cannot read one. Not solved for contrast
 *  either — `/20` is a separator at 1.45:1. */
export function inkScale(palette: ThemePalette): InkScale {
  const cached = cache.get(palette);
  if (cached) return cached;

  const ladder = MUTED_STEPS.map((step) => mixHex(palette.paper, palette.ink, step / 100));

  // Nothing below the ink qualifies on `solarized-light` (ink 4.85:1), so that
  // palette's muted level IS its ink rather than a value that only looks legal.
  const muted =
    ladder.find((color) => worstTextContrast(color, palette) >= MUTED_CONTRAST_FLOOR) ??
    palette.ink;

  const scale: InkScale = {
    ink: palette.ink,
    ladder,
    muted,
    // Opaque: the paper base is what makes the chip independent of its backdrop.
    codeFill: mixHex(palette.paper, palette.ink, CODE_FILL_PERCENT / 100),
  };
  cache.set(palette, scale);
  return scale;
}

/** Muted text for an inverted surface. Measured, `text-canvas/60` on `bg-ink`
 *  reads 2.91:1 on `solarized-light`, so this is solved rather than alphas. */
export function onInkTextColor(palette: ThemePalette): string {
  if (!parseHexColor(palette.canvas)) return palette.canvas;
  if (contrastBetween(palette.canvas, palette.ink) >= MUTED_CONTRAST_FLOOR) return palette.canvas;
  for (let ratio = MIX_STEP; ratio <= 1; ratio += MIX_STEP) {
    // Toward WHITE on a light palette and BLACK on a dark one: the text must
    // move AWAY from the ink surface it is painted on.
    const extreme = palette.variant === 'dark' ? '#000000' : '#ffffff';
    const mixed = mixHex(palette.canvas, extreme, ratio);
    if (contrastBetween(mixed, palette.ink) >= MUTED_CONTRAST_FLOOR) return mixed;
  }
  return palette.canvas;
}

/** The five signal slots the UI also prints as words. */
export type SignalSlot = 'error' | 'success' | 'info' | 'warning' | 'meta';

export const SIGNAL_SLOTS: readonly SignalSlot[] = ['error', 'success', 'info', 'warning', 'meta'];

/** A signal colour mixed toward the extreme until it reads as TEXT. Measured,
 *  `success` is 1.75:1 on `nord-light` — the hex is chosen for a fill, not a word.
 *  The fill itself (`bg-error`) keeps the palette colour. */
export function signalTextColor(palette: ThemePalette, slot: SignalSlot): string {
  const base = palette[slot];
  if (!parseHexColor(base)) return base;
  if (worstTextContrast(base, palette) >= MUTED_CONTRAST_FLOOR) return base;

  // Toward BLACK on a light palette and WHITE on a dark one: the signal keeps
  // its hue and moves away from its surface, which is what "make this readable
  // without changing what it means" looks like.
  const extreme = palette.variant === 'dark' ? '#ffffff' : '#000000';
  for (let ratio = MIX_STEP; ratio <= 1; ratio += MIX_STEP) {
    const mixed = mixHex(base, extreme, ratio);
    if (worstTextContrast(mixed, palette) >= MUTED_CONTRAST_FLOOR) return mixed;
  }
  return extreme;
}
