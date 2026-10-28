/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Hex color arithmetic for the places that cannot use CSS.
 *
 * `color-mix()` covers every blend inside the document, but xterm parses theme
 * colors itself (it accepts `#rgb`, `#rrggbb`, `rgb()`, `hsl()` and named
 * colors — not `color-mix()`, in either the DOM or the WebGL renderer), so the
 * terminal palette has to be computed here and handed over as literal hex.
 *
 * The palette values are ported verbatim from OpenChamber and are therefore not
 * uniform: `#FFF` (jetbrains-light) and 8-digit alpha (`#dbd7caee`,
 * vitesse-dark) both appear, and a blend has to composite the alpha rather than
 * pretend it is opaque.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–1. */
  a: number;
}

const HEX_SHORT = /^#?([0-9a-f]{3})$/i;
const HEX_LONG = /^#?([0-9a-f]{6})$/i;
const HEX_ALPHA = /^#?([0-9a-f]{8})$/i;

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa`. `null` for anything else. */
export function parseHexColor(value: string): Rgba | null {
  const trimmed = value.trim();
  const short = HEX_SHORT.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split('');
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16), a: 1 };
  }
  const long = HEX_LONG.exec(trimmed);
  if (long) {
    const n = parseInt(long[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 };
  }
  const alpha = HEX_ALPHA.exec(trimmed);
  if (alpha) {
    const n = parseInt(alpha[1], 16);
    return { r: (n >>> 24) & 0xff, g: (n >> 16) & 0xff, b: (n >> 8) & 0xff, a: (n & 0xff) / 255 };
  }
  return null;
}

function toHex2(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

export function rgbaToHex({ r, g, b }: Rgba): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

/**
 * `ratio` of `blend` laid over `base` (0 = base, 1 = blend), compositing
 * `blend`'s own alpha. Falls back to `base` when either value cannot be parsed,
 * so a palette with an unexpected notation still yields a paintable color.
 */
export function mixHex(base: string, blend: string, ratio: number): string {
  const under = parseHexColor(base);
  const over = parseHexColor(blend);
  if (!under || !over) return base;
  const weight = over.a * ratio;
  return rgbaToHex({
    r: under.r * (1 - weight) + over.r * weight,
    g: under.g * (1 - weight) + over.g * weight,
    b: under.b * (1 - weight) + over.b * weight,
    a: 1,
  });
}

/** WCAG relative luminance, used to order two palette colors light-to-dark. */
export function relativeLuminance(value: string): number {
  const color = parseHexColor(value);
  if (!color) return 0;
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}
