/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The code surface's type and chrome, in CodeMirror's own theme format.
 *
 * Type is INHERITED, not restated: the host element carries the font family,
 * size and line box (the zoom control and the editor-font setting both write
 * there), and `.cm-editor` inherits them. That is what keeps a zoom step a pure
 * CSS change — a theme extension carrying a pixel size would have to be
 * reconfigured on every step, and every reconfigure re-creates the editor's
 * plugins (including the tokenizer).
 *
 * Colours are read through `--editor-*` custom properties with the app's
 * palette as the FALLBACK:
 *
 * - `auto` (the default) writes none of them, so every declaration resolves to
 *   `--theme-*` and an app theme flip repaints the editor with zero JS — the
 *   same property the Shiki decorations rely on.
 * - An explicit editor theme writes them on the surface's own host element
 *   (`editorThemeVars`), so the editor paints Dracula while the console around
 *   it stays on the app palette. Because the values arrive as CSS, switching
 *   between two editor themes is also a repaint: nothing here is reconfigured.
 *
 * The one rule that cannot be a variable is the TOKEN colour. Shiki emits both
 * palettes on every token, and which one paints is decided by the app's variant
 * attribute — except an explicit editor theme tokenizes with ITSELF in both
 * slots, so the two custom properties carry identical values and either one is
 * correct. That is why the dark rule below is safe to state unconditionally.
 */

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** The surface's own CSS. Everything here is structural, never per-layout. */
export function surfaceTheme(): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'var(--editor-bg, transparent)',
      color: 'var(--editor-fg, var(--theme-ink))',
      fontSize: 'inherit',
      fontFamily: 'inherit',
      lineHeight: 'inherit',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
    },
    '.cm-content': {
      // CM6 reads these two back as the document's padding, which is why the
      // breathing room belongs here and not on a wrapper: a scroll container's
      // own padding is not part of its scrollable overflow.
      paddingTop: 'var(--surface-pad, 16px)',
      paddingBottom: 'var(--surface-pad, 16px)',
      caretColor: 'var(--editor-cursor, var(--theme-ink))',
    },
    '.cm-line': { padding: '0 var(--surface-pad, 16px)' },
    // The gutter is CM6's own (lineNumbers()), styled to the panel's band. An
    // explicit editor theme paints it in the theme's own surface, which is what
    // VS Code does for the 46 themes that ship no `editorGutter.background`.
    '.cm-gutters': {
      backgroundColor: 'var(--editor-bg, var(--theme-canvas))',
      color: 'var(--editor-gutter-fg, color-mix(in srgb, var(--theme-ink) 30%, transparent))',
      border: 'none',
      borderRight: '1px solid var(--editor-border, color-mix(in srgb, var(--theme-ink) 10%, transparent))',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 12px 0 16px',
      minWidth: '1.5rem',
      textAlign: 'right',
    },
    // The selection is drawn by `drawSelection()`; the native one is left to
    // the browser when the editor is not focused.
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--editor-selection, color-mix(in srgb, var(--theme-ink) 20%, transparent))',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--editor-cursor, var(--theme-ink))',
    },
    // A find match, painted by the decoration field (`marks.ts`). The geometry
    // rules are the ones the old markup layer needed: horizontal edges only, or
    // a match spanning several tokens paints a seam between them.
    '.cm-content .find-match': {
      color: 'inherit',
      backgroundColor: 'var(--editor-find, color-mix(in srgb, var(--theme-warning) 32%, transparent))',
    },
    '.cm-content .find-match[data-find-current]': {
      backgroundColor:
        'var(--editor-find-current, color-mix(in srgb, var(--theme-warning) 55%, transparent))',
      borderTop: '1px solid color-mix(in srgb, var(--theme-warning) 75%, transparent)',
      borderBottom: '1px solid color-mix(in srgb, var(--theme-warning) 75%, transparent)',
    },
    // Shiki tokens. The colour itself comes from the custom properties the
    // decoration carries; `tailwind.css` holds the same pair for every other
    // surface, and this block is the editor's copy of it. The `&`-less form
    // below is CM6's base-class prefix, and the second rule is why an app theme
    // flip repaints tokens with no re-tokenize.
    '.cm-content .shiki-tok': { color: 'var(--shiki-light)' },
    'html[data-theme-variant="dark"] & .cm-content .shiki-tok': { color: 'var(--shiki-dark)' },
    '.cm-placeholder': { color: 'color-mix(in srgb, var(--editor-fg, var(--theme-ink)) 35%, transparent)' },
  });
}
