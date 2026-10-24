/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which editor theme is live, and how a change reaches an open editor.
 *
 * The setting is visual, so it has to apply to the editor on screen — not on the
 * next reload. `appSettings` is a prop captured at boot, so reading it once
 * would leave an already-mounted editor on the previous palette; this follows
 * the editor FONT's shape (`hooks/editor/font.ts`): the picker writes the
 * setting and announces it, and every editor subscribes.
 *
 * A theme's module is fetched the first time it is SELECTED (`theme-loader.ts`),
 * so an install that never opens the picker downloads none of them.
 */

import { useEffect, useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import {
  EDITOR_AUTO_THEME_ID,
  EDITOR_DEFAULT_THEME_ID,
  editorShikiThemes,
  editorThemeVars,
  resolveEditorTheme,
  type EditorTheme,
} from '@/shared/lib/code/editor/themes';
import { loadEditorTheme } from '@/shared/lib/code/editor/theme-loader';

/** Broadcast on every editor-theme write. Detail is the new theme id. */
export const EDITOR_THEME_CHANGED_EVENT = 'omp:editor-theme-changed';

/** The theme id currently stored, falling back to `auto`. */
export function currentEditorThemeId(): string {
  if (typeof window === 'undefined') return EDITOR_DEFAULT_THEME_ID;
  return readKabmoSetting<string>('editorTheme') ?? EDITOR_DEFAULT_THEME_ID;
}

/** Everything a code surface needs to paint with the live editor theme. */
export interface EditorThemeState {
  /** The theme itself, or `null` for `auto` (the app palette). */
  theme: EditorTheme | null;
  /** CSS custom properties for the surface host; empty for `auto`. */
  vars: Record<string, string>;
  /** The two Shiki theme names to tokenize with. */
  themes: { light: string; dark: string };
}

const AUTO_STATE: EditorThemeState = { theme: null, vars: {}, themes: editorShikiThemes(null) };

/**
 * The live editor theme, kept in step with writes.
 *
 * One hook rather than three, because a surface needs all three values and
 * three subscriptions to one event would be three re-render paths that can
 * disagree for a frame.
 */
export function useEditorTheme(): EditorThemeState {
  const [id, setId] = useState<string>(currentEditorThemeId);

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setId(detail || currentEditorThemeId());
    };
    window.addEventListener(EDITOR_THEME_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(EDITOR_THEME_CHANGED_EVENT, onChange);
  }, []);

  // Fetch the module the first time this theme is live, so the tokenizer can
  // colour with it. A no-op for `auto` and for an id already registered.
  useEffect(() => {
    void loadEditorTheme(id);
  }, [id]);

  // `auto` is the shipped state, and it allocates nothing new per render.
  if (id === EDITOR_AUTO_THEME_ID) return AUTO_STATE;

  const theme = resolveEditorTheme(id);
  return { theme, vars: editorThemeVars(theme), themes: editorShikiThemes(id) };
}
