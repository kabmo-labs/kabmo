/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The accent palette a workspace may be marked with, in ONE table.
 *
 * The server serves it and the settings palette falls back to it, so the two
 * cannot disagree about which swatches exist — they were duplicated before, and
 * a colour added on one side was simply missing on the other.
 *
 * These are DATA, not theme tokens: an accent is a per-project mark, and every
 * value here is drawn as a swatch (never as component chrome), which is why they
 * are allowed literal hex. This table is the PRESETS — a user may also store any
 * other hex through the custom picker, so nothing may treat membership here as
 * the set of valid accents.
 */

import type { AccentColorOption } from '@/shared/types';
import { legiblePair } from '@/shared/lib/theme/legibility';

/**
 The accent the custom picker starts on: a violet that is deliberately NOT one of
 the swatches, so the custom control is visibly its own choice rather than an
 eleventh preset.
 */
export const DEFAULT_CUSTOM_ACCENT = '#7c3aed';

/** An accent may be empty (no mark) or `#rgb` / `#rrggbb`, nothing else. */
const HEX_ACCENT = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 The stored form of a hex accent: lowercase, always six digits.

 Returns `null` for anything that is not a hex colour, so the caller decides
 whether to refuse it or fall back — this module does not guess. The accent ends
 up in a CSS `color`, and a free-form string there is a style injection: `red;
 background:url(…)` paints the sidebar.
 */
export function normalizeHexAccent(value: string): string | null {
  if (!HEX_ACCENT.test(value)) return null;
  const lower = value.toLowerCase();
  if (lower.length === 7) return lower;
  return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`;
}

/** True when the value is a stored-form hex accent, i.e. what the server keeps. */
export function isHexAccent(value: string): boolean {
  return normalizeHexAccent(value) === value && value !== '';
}

/**
 * The accent as the two custom properties a markup style needs.
 *
 * The stored hex is what the user picked, and it is drawn as a SWATCH — a dot, a
 * preset circle — where a fill is its own background and any hex is legible. A
 * GLYPH is different: it is painted on paper, and measured over the shipped
 * presets, nine of the ten fall below the 3:1 floor there (`#a3e635` reads
 * 1.15:1 on the darkest light paper, `#fbbf24` 1.27:1). So the mark takes the
 * clamped pair `legiblePair` derives for every other brand colour, and the
 * swatch keeps the exact hex.
 *
 * Returns an empty object for "no accent", so a caller can spread it.
 */
export function projectAccentStyle(accent: string | null | undefined): Record<string, string> {
  if (!accent) return {};
  const pair = legiblePair(accent);
  return {
    '--project-accent': pair.light,
    '--project-accent-dark': pair.dark ?? pair.light,
  };
}

export const PROJECT_ACCENT_OPTIONS: AccentColorOption[] = [
  { label: 'None', value: '', bgHex: 'transparent' },
  { label: 'Sky Blue', value: '#38bdf8', bgHex: '#38bdf8' },
  { label: 'Light Green', value: '#a3e635', bgHex: '#a3e635' },
  { label: 'Coral', value: '#f87171', bgHex: '#f87171' },
  { label: 'Amber', value: '#fbbf24', bgHex: '#fbbf24' },
  { label: 'Teal', value: '#2dd4bf', bgHex: '#2dd4bf' },
  { label: 'Slate', value: '#94a3b8', bgHex: '#94a3b8' },
  { label: 'Rose', value: '#f43f5e', bgHex: '#f43f5e' },
  { label: 'Vivid Blue', value: '#3b82f6', bgHex: '#3b82f6' },
  { label: 'Lime Green', value: '#84cc16', bgHex: '#84cc16' },
];
