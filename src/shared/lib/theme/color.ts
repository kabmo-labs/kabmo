/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Hex color arithmetic for the places that cannot use CSS.
 *
 * `color-mix()` covers every blend inside the document, but the terminal
 * renderer takes only literal colors (it hands them to `ctx.fillStyle`, which
 * does not resolve `color-mix()`), so the terminal palette has to be computed
 * here and handed over as hex.
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

/**
 * OKLCH, for the one place sRGB arithmetic is measurably wrong: shading a hue
 * toward another tone.
 *
 * The icon tones are the reason. Mixing `#FFD21E` toward black in sRGB keeps
 * 63% of its chroma where the same move in OKLCH keeps it whole, because sRGB
 * channels are not perceptually spaced — a dark yellow drifts to olive. So the
 * light icon tone is *solved* here: hold the hue, take the most chroma sRGB can
 * actually show at that lightness, and then check the result with WCAG contrast.
 *
 * Values are the standard Björn Ottosson transform: OKLab is the linear part,
 * OKLCH is that in polar form.
 */
export function oklchToRgb(lightness: number, chroma: number, hue: number): Rgba & { inGamut: boolean } {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  // Linear-light sRGB, then the transfer function.
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ] as const;
  const channel = (value: number) => {
    const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    return encoded * 255;
  };
  // A hair of slack: at the gamut surface the transform lands on `-1e-8`, and
  // an exact test would reject colours that round to a perfectly valid byte.
  const inGamut = linear.every((value) => value >= -0.0005 && value <= 1.0005);
  return { r: channel(linear[0]), g: channel(linear[1]), b: channel(linear[2]), a: 1, inGamut };
}

/** The most chroma sRGB can show at this lightness and hue. */
export function maxChromaInGamut(lightness: number, hue: number): number {
  let low = 0;
  let high = 0.4;
  for (let step = 0; step < 16; step += 1) {
    const mid = (low + high) / 2;
    if (oklchToRgb(lightness, mid, hue).inGamut) low = mid;
    else high = mid;
  }
  return low;
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
