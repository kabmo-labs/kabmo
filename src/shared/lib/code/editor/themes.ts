/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The EDITOR's colour themes, independent of the app palette.
 *
 * CodeMirror can wear any of the 65 TextMate themes `@shikijs/themes` ships, and
 * a reader who works in Dracula or Nord wants the code surface to say so while
 * the console around it stays in the app's own palette. That separation is the
 * whole feature: `SettingsState.editorTheme` is a second axis beside `theme`,
 * and the editor paints its own surface, gutter, selection and tokens from it.
 *
 * Three rules keep it honest:
 *
 * - **`auto` is the default and means "the app's own palette".** Nothing changes
 *   for an install that never opens the picker: the surface stays transparent
 *   over the panel, the chrome reads `--theme-*`, and the tokenizer keeps the
 *   dual `one-light`/`one-dark-pro` pair the app variant selects.
 * - **The data is generated, never typed.** `themes.generated.ts` is written by
 *   `scripts/editor-themes.mjs` from the installed package, so the picker's
 *   swatches are the theme's OWN colours and a `@shikijs/themes` bump cannot
 *   leave the grid showing a palette that no longer exists.
 * - **A theme module is only fetched when it is selected.** The rows carry
 *   enough colour to draw the grid; `EDITOR_THEME_LOADERS` is what the
 *   highlighter calls, and 65 modules nobody picks are never downloaded.
 *
 * The picker's swatch shows the editor surface, the ink and three syntax
 * accents — the five colours that actually tell two themes apart at 120px.
 */

import { EDITOR_THEME_LOADERS, EDITOR_THEME_ROWS } from '@/shared/lib/code/editor/themes.generated';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';

/** The setting value meaning "follow the app palette". */
export const EDITOR_AUTO_THEME_ID = 'auto';

/** What a settings row that predates this option holds. */
export const EDITOR_DEFAULT_THEME_ID = EDITOR_AUTO_THEME_ID;

export type EditorThemeVariant = 'light' | 'dark';

export interface EditorTheme {
  /** Shiki's theme id, which is also the stored setting value. */
  id: string;
  label: string;
  /** The theme's OWN light/dark verdict — never the app's. */
  variant: EditorThemeVariant;
  /** The editor surface and its ink. */
  bg: string;
  fg: string;
  /** Line-number band. */
  gutterFg: string;
  /** Selection band, caret, and the two find-match bands. */
  selection: string;
  cursor: string;
  find: string;
  findCurrent: string;
  /** Divider between the gutter and the text. */
  border: string;
  /** The two diff bands and their gutter markers. */
  added: string;
  removed: string;
  addedGutter: string;
  removedGutter: string;
  /** Three syntax accents, for the picker's swatch only. */
  keyword: string;
  string: string;
  comment: string;
}

/**
 * The tuple's field order, stated once so the generated rows and this mapping
 * cannot drift: a column added to the generator without a field here is a type
 * error rather than a silently shifted colour.
 */
type EditorThemeRow = (typeof EDITOR_THEME_ROWS)[number];

const FIELD_ORDER = [
  'id',
  'label',
  'variant',
  'bg',
  'fg',
  'gutterFg',
  'selection',
  'cursor',
  'find',
  'findCurrent',
  'border',
  'added',
  'removed',
  'addedGutter',
  'removedGutter',
  'keyword',
  'string',
  'comment',
] as const satisfies ReadonlyArray<keyof EditorTheme>;

function toTheme(row: EditorThemeRow): EditorTheme {
  const theme = {} as EditorTheme;
  FIELD_ORDER.forEach((field, index) => {
    // The tuple and the field list are asserted equal by the types, so this
    // cast is the only place the two meet.
    (theme as unknown as Record<string, string>)[field] = row[index];
  });
  return theme;
}

/** Every theme the installed Shiki ships, in id order (the generator's order). */
export const EDITOR_THEMES: readonly EditorTheme[] = EDITOR_THEME_ROWS.map(toTheme);

const BY_ID = new Map(EDITOR_THEMES.map((theme) => [theme.id, theme]));

/**
 * The theme a stored setting names, or `null` for `auto` — and for an id this
 * build no longer ships (a downgrade, a hand-edited row), which must render the
 * app palette rather than a half-applied theme.
 */
export function resolveEditorTheme(id: string | null | undefined): EditorTheme | null {
  if (!id || id === EDITOR_AUTO_THEME_ID) return null;
  return BY_ID.get(id) ?? null;
}

/** True when `id` is a theme this build can paint. */
export function isEditorThemeId(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * The two theme names Shiki tokenizes with.
 *
 * `auto` keeps the app's dual pair, so the variant attribute picks the palette
 * exactly as it does for every other surface. An explicit theme names ITSELF
 * for both slots — one theme, both custom properties, identical values — which
 * is what makes the editor ignore the app variant without a second CSS path.
 */
export function editorShikiThemes(id: string | null | undefined): { light: string; dark: string } {
  const theme = resolveEditorTheme(id);
  if (!theme) return SHIKI_THEMES;
  return { light: theme.id, dark: theme.id };
}

/** The CSS custom properties an explicit theme writes, keyed by variable name. */
export function editorThemeVars(theme: EditorTheme | null): Record<string, string> {
  if (!theme) return {};
  return {
    '--editor-bg': theme.bg,
    '--editor-fg': theme.fg,
    '--editor-gutter-fg': theme.gutterFg,
    '--editor-selection': theme.selection,
    '--editor-cursor': theme.cursor,
    '--editor-find': theme.find,
    '--editor-find-current': theme.findCurrent,
    '--editor-border': theme.border,
    '--editor-added': theme.added,
    '--editor-removed': theme.removed,
    '--editor-added-gutter': theme.addedGutter,
    '--editor-removed-gutter': theme.removedGutter,
  };
}

/** The lazy module loaders, so the highlighter can fetch one theme on demand. */
export { EDITOR_THEME_LOADERS };
