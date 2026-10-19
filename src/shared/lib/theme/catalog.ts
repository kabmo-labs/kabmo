/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The theme catalog: every palette Kabmo can paint, the lookups the whole
 * app resolves a stored theme id through, and the light/dark verdict that used
 * to be re-derived by hand in four places (`hooks/ui/theme.ts`,
 * `code/shiki-themes.ts`, `markdown/mermaid.ts`, `server/plugins/ssr.ts`) — each
 * with its own hardcoded id list that a new theme would have silently missed.
 *
 * Pure data plus pure functions: no DOM, no CSS, no server imports, so the
 * client, the SSR shell and the tests all read the same catalog.
 */

import type { ThemePalette, ThemeSwatch } from '@/shared/types/theme';
import { KABMO_PALETTES } from '@/shared/lib/theme/palettes/kabmo';
import { DARK_PALETTES } from '@/shared/lib/theme/palettes/dark';
import { LIGHT_PALETTES } from '@/shared/lib/theme/palettes/light';

/** The shipped default, and the fallback for any id the catalog does not know. */
export const DEFAULT_THEME_ID = 'paper';

/**
 * Every id in the catalog, as a literal union. `SettingsState.theme` is typed
 * with it, so a typo — or a theme dropped from the catalog — is a compile error
 * at the writer instead of an unstyled page at runtime.
 */
export type ThemeId =
  | (typeof KABMO_PALETTES)[number]['id']
  | (typeof LIGHT_PALETTES)[number]['id']
  | (typeof DARK_PALETTES)[number]['id'];

const ALL_PALETTES = [...KABMO_PALETTES, ...LIGHT_PALETTES, ...DARK_PALETTES];

const BY_ID: Record<string, ThemePalette | undefined> = Object.fromEntries(
  ALL_PALETTES.map((theme) => [theme.id, theme]),
);

const DEFAULT_PALETTE: ThemePalette = KABMO_PALETTES[0];

/**
 * Every palette, in appearance-grid order: Kabmo's own three first (the
 * ones an existing install is already using), then each ported family with its
 * light and dark entry adjacent.
 *
 * Pairing is by family key rather than by array index, so a re-port that
 * updates one variant of a family cannot silently shift every pair after it.
 */
export const THEMES: readonly ThemePalette[] = (() => {
  const families = new Map<string, ThemePalette[]>();
  for (const palette of [...LIGHT_PALETTES, ...DARK_PALETTES]) {
    const group = families.get(palette.family);
    if (group) group.push(palette);
    else families.set(palette.family, [palette]);
  }
  return [...KABMO_PALETTES, ...[...families.values()].flat()];
})();

/**
 * Resolve a stored theme id to a palette the catalog can actually paint.
 *
 * A settings row can name a theme this build no longer ships — a downgrade, or
 * the `noir` alias that was byte-identical to `one-dark-pro-soft` and is gone.
 * Every reader goes through here, so an unknown id renders the default instead
 * of an unstyled page.
 */
export function resolveTheme(id: string | undefined | null): ThemePalette {
  return (id ? BY_ID[id] : undefined) ?? DEFAULT_PALETTE;
}

export function isDarkTheme(id: string | undefined | null): boolean {
  return resolveTheme(id).variant === 'dark';
}

/**
 * The catalog's own id for `id`, falling back to the default.
 *
 * The single narrowing point between a runtime string (a stored setting, a
 * button's payload) and `ThemeId`: every palette's `id` is one of the union's
 * members by construction, which is the fact the cast asserts.
 */
export function resolveThemeId(id: string | undefined | null): ThemeId {
  return resolveTheme(id).id as ThemeId;
}

/** The eight slots a palette card shows, in paint order. */
export const THEME_SWATCHES: readonly ThemeSwatch[] = [
  { key: 'canvas', label: 'Canvas' },
  { key: 'paper', label: 'Surface' },
  { key: 'ink', label: 'Ink' },
  { key: 'error', label: 'Error' },
  { key: 'success', label: 'Success' },
  { key: 'info', label: 'Info' },
  { key: 'warning', label: 'Warning' },
  { key: 'meta', label: 'Accent' },
];
