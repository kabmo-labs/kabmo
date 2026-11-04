/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The colour every FUNCTIONAL glyph is painted in, in `color` mode.
 *
 * Lucide draws each icon as a stroke in `currentColor`, so "full colour" for a
 * functional glyph can only mean a TINT — there is no second artwork to swap in.
 * Two rules decide which tint, and they answer different questions:
 *
 * - **A signal icon means something, so it takes the palette's signal colour**
 *   ({@link ICON_TINTS}): a trash can is destructive, a check is a confirmation,
 *   a clock is waiting, an info dot is information. Those colours already exist
 *   in every palette, and a themed `--theme-error` follows the user's theme the
 *   way a literal red cannot.
 * - **Every other icon gets its OWN hue** ({@link ICON_HUES}, generated). One
 *   shared accent for the remaining two hundred glyphs is the failure mode this
 *   avoids: a mode that colours a dozen icons and leaves the rest identical is
 *   not "full colour", it is one colour. The hue comes from a stable hash of the
 *   name, quantised to a 36-step wheel, so two neighbouring icons differ without
 *   the table being 250 hand-picked decisions.
 *
 * Both are DEFAULT paint, never an override: the stylesheet wraps every selector
 * in `:where()`, so a `text-*` class a caller wrote on the element still wins
 * (see `icon-paint-css.ts`).
 *
 * Keys are the names the code IMPORTS (`Trash2`), not the emitted class, so a
 * row is checkable against the call site it describes; {@link lucideClassName}
 * is the single translation to `lucide-trash-2`.
 */

import { ICON_HUES } from '@/shared/lib/icons/tint-hues.generated';

export type IconTintRole = 'error' | 'success' | 'warning' | 'info';

/** The CSS value each role paints. Tokens only — never a hex. */
export const ICON_TINT_TOKENS: Readonly<Record<IconTintRole, string>> = {
  error: 'var(--theme-error)',
  success: 'var(--theme-success)',
  warning: 'var(--theme-warning)',
  info: 'var(--theme-info)',
};

/**
 * Saturation and lightness the generated hues are painted with, per variant.
 *
 * These two pairs are the whole legibility budget: measured against every light
 * palette, `60% 30%` keeps its worst hue at 3.46:1 (the floor is 3:1 for a
 * graphic) even on `tokyonight-light`'s `#dee0ee` paper, and `65% 70%` keeps the
 * worst dark hue at 4.07:1 on `jetbrains-dark`'s `#2B2D30`. A lighter light
 * value (34%) drops two hues below the floor, which is why it is not "prettier".
 */
export const ICON_HUE_PAINT = {
  light: { saturation: 60, lightness: 30 },
  dark: { saturation: 65, lightness: 70 },
} as const;

/** The hue an icon with no row keeps — a neutral blue, never a sixth signal. */
export const DEFAULT_ICON_HUE = 210;

/** One hue as a paintable `hsl()`. The single place the numbers become CSS. */
export function iconHueColor(hue: number, variant: 'light' | 'dark'): string {
  const { saturation, lightness } = ICON_HUE_PAINT[variant];
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

/** The paint rule's value: the hue left to the custom property the class sets. */
export function iconHuePaint(variant: 'light' | 'dark'): string {
  const { saturation, lightness } = ICON_HUE_PAINT[variant];
  return `hsl(var(--icon-hue, ${DEFAULT_ICON_HUE}) ${saturation}% ${lightness}%)`;
}

/** Glyph name → the signal it stands for. Everything else gets a generated hue. */
export const ICON_TINTS: Readonly<Record<string, IconTintRole>> = {
  // Failures, destructive actions, and things that are broken.
  AlertCircle: 'error',
  AlertTriangle: 'error',
  Ban: 'error',
  Bug: 'error',
  BugOff: 'error',
  CircleAlert: 'error',
  CircleSlash: 'error',
  FileWarning: 'error',
  FileX: 'error',
  OctagonAlert: 'error',
  OctagonX: 'error',
  PackageX: 'error',
  ShieldAlert: 'error',
  Trash2: 'error',
  XCircle: 'error',

  // Confirmations and healthy state.
  Check: 'success',
  CheckCheck: 'success',
  CheckCircle2: 'success',
  CheckSquare: 'success',
  PackageCheck: 'success',
  ShieldCheck: 'success',

  // A file whose VIEWER is the point: the hue is what tells a reader at a
  // glance that the document opens as something other than source text. These
  // carried fixed hexes before the mode existed, which made them the only icons
  // that ignored it.
  Braces: 'warning',
  FileArchive: 'warning',
  FileSpreadsheet: 'success',
  FileType: 'warning',

  // Attention: something is pending, scheduled or in flight.
  Bell: 'warning',
  Calendar: 'warning',
  CalendarRange: 'warning',
  Clock: 'warning',
  Clock3: 'warning',
  Hourglass: 'warning',

  // Information, help and reading.
  BookOpen: 'info',
  CircleQuestionMark: 'info',
  Compass: 'info',
  HelpCircle: 'info',
  Info: 'info',
};

/**
 * `Trash2` -> `trash-2`: the class Lucide emits for that component.
 *
 * Lucide names the class from the icon's own canonical name and adds one per
 * alias, so a legacy import name (`Trash2`, `AlertTriangle`) still matches its
 * own class — which is why this conversion is enough and the table can stay in
 * the vocabulary of the call sites.
 */
export function kebabIconName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .toLowerCase();
}

/** The class Lucide puts on the `<svg>` for an imported icon name. */
export function lucideClassName(name: string): string {
  return `lucide-${kebabIconName(name)}`;
}

/** The signal role for an imported icon name, or `null` when it has none. */
export function iconTintRole(name: string): IconTintRole | null {
  return ICON_TINTS[name] ?? null;
}

/** The generated hue for an imported icon name. */
export function iconHue(name: string): number {
  return ICON_HUES[name] ?? DEFAULT_ICON_HUE;
}

/** The wheel the hashes land on: 36 hues, 10° apart. */
export const HUE_STEPS = 36;

/**
 * The hue of anything that is not in the generated table — a plugin's mark.
 *
 * Plugin names arrive at RUNTIME, so they cannot be baked into a table: the
 * manifest is read from disk and a marketplace install adds rows no build could
 * have seen. The hue is therefore computed here, with the SAME function that
 * produced every generated row (`scripts/icon-tints.mjs`, asserted equal in
 * `tint.test.ts`), so a plugin's colour sits on the same wheel as the glyphs
 * around it instead of inventing a second palette.
 *
 * FNV-1a, 36 steps of 10°: stable across runs and platforms, which a colour for
 * stored data has to be.
 */
export function hashHue(name: string): number {
  let hash = 2166136261 >>> 0;
  for (const char of name) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash % HUE_STEPS) * (360 / HUE_STEPS);
}

/**
 * One hue per PANEL, with collisions resolved.
 *
 * A rail draws ~14 marks and the wheel has 36 slots, so a plain hash collides
 * about nine times in ten (birthday bound) — measured on the right rail: three
 * of its fourteen icons landed on the same blue, which is the opposite of "each
 * icon has its own colour". Panels are a KNOWN, stable set per rail, so the
 * collision can be resolved deterministically: sort the ids, take each hash, and
 * probe forward 10° at a time until the slot is free. Sorting makes the answer
 * independent of the catalog's order, so reordering a rail never recolours it.
 *
 * A plugin and a built-in compete in the same space on purpose: they sit in one
 * bar, and two neighbours in the same hue is the defect this avoids.
 */
export function assignPanelHues(ids: readonly string[]): Map<string, number> {
  const hues = new Map<string, number>();
  const taken = new Set<number>();
  for (const id of [...ids].sort()) {
    let hue = hashHue(id);
    for (let step = 0; step < HUE_STEPS && taken.has(hue); step += 1) {
      hue = (hue + 360 / HUE_STEPS) % 360;
    }
    taken.add(hue);
    hues.set(id, hue);
  }
  return hues;
}

/** Signal rows, as `{ className, role }`, for the stylesheet generator. */
export const ICON_TINT_ROWS: ReadonlyArray<{ className: string; role: IconTintRole }> = Object.entries(
  ICON_TINTS,
).map(([name, role]) => ({ className: lucideClassName(name), role }));

/** Generated-hue rows, as `{ className, hue }`, for the stylesheet generator. */
export const ICON_HUE_ROWS: ReadonlyArray<{ className: string; hue: number }> = Object.entries(ICON_HUES).map(
  ([name, hue]) => ({ className: lucideClassName(name), hue }),
);