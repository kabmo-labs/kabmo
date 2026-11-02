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
