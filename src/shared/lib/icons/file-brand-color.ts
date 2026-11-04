/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The official colour of every file-type brand mark, resolved for both variants.
 *
 * `file-brand-paths.ts` carries Simple Icons' hex, which is chosen for the
 * brand's own background. The same problem the provider marks have applies here
 * — a `#F7DF1E` JavaScript yellow is 1.28:1 on the lightest paper — so the
 * painted values come from the shared {@link legiblePair} rule instead of a
 * second hand-maintained table.
 *
 * `dark: null` means "monochrome art": the mark is drawn in the theme's ink.
 */

import { BRAND_ICONS } from '@/shared/lib/icons/file-brand-paths';
import { legiblePair } from '@/shared/lib/theme/legibility';

export interface FileBrandColor {
  /** The official Simple Icons hex, as published. */
  base: string;
  light: string;
  dark: string | null;
}

export const FILE_BRAND_COLORS: Readonly<Record<string, FileBrandColor>> = Object.fromEntries(
  Object.entries(BRAND_ICONS).map(([name, brand]) => [name, { base: brand.color, ...legiblePair(brand.color) }]),
);

/** The colour a file-type mark is painted in, or `null` for the theme ink. */
export function fileBrandColorFor(name: string | null | undefined, variant: 'light' | 'dark'): string | null {
  if (!name) return null;
  const entry = FILE_BRAND_COLORS[name];
  if (!entry) return null;
  return variant === 'dark' ? entry.dark : entry.light;
}
