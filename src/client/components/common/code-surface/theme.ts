/**
 * @license
 * SPDX-License-Identifier: MIT
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
    // The fold gutter, beside the line numbers. Its marker is a text glyph
    // (`⌄` / `›`) inside a span, so the box needs a fixed width or the gutter
    // shifts sideways as a block opens and closes.
    //
    // The colour reads `--editor-fg` FIRST: an explicit editor theme paints a
    // surface of its own (`Dracula` over a light app palette), and the app's ink
    // at 45% over that background is a glyph the reader cannot see — measured on
    // the diff panel, which is the one Reader that can wear a dark editor theme
    // inside a light console.
    '.cm-foldGutter .cm-gutterElement': {
      padding: '0 4px 0 2px',
      minWidth: '1.1rem',
      textAlign: 'center',
    },
    '.cm-foldGutter .cm-gutterElement span': {
      display: 'inline-block',
      width: '100%',
      cursor: 'pointer',
      color: 'color-mix(in srgb, var(--editor-fg, var(--theme-ink)) 45%, transparent)',
    },
    '.cm-foldGutter .cm-gutterElement span:hover': { color: 'var(--editor-fg, var(--theme-ink))' },
    // A folded range's own `…`. Two facts about this rule are load-bearing.
    //
    // 1. The declarations are LONGHAND. `border: 1px solid var(--x)` is a
    //    shorthand style-mod tries to EXPAND, and it cannot parse a `var()` —
    //    measured: it emits `border-width: var(--theme-ink)` and
    //    `border-style: var(--theme-ink)`, i.e. garbage that paints nothing.
    //    `borderWidth` / `borderStyle` / `borderColor` sidestep the expansion.
    // 2. The package's own rule is `.ͼ1 .cm-foldPlaceholder` (0,1,0) and ours is
    //    `.ͼN .cm-foldPlaceholder` (0,1,0) too — a tie, so ORDER decides, and
    //    CM6 mounts our theme after the base one. Verified: our rule is emitted
    //    last and wins.
    '.cm-foldPlaceholder': {
      backgroundColor: 'color-mix(in srgb, var(--editor-fg, var(--theme-ink)) 7%, var(--editor-bg, var(--theme-canvas)))',
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: 'color-mix(in srgb, var(--editor-fg, var(--theme-ink)) 18%, transparent)',
      color: 'color-mix(in srgb, var(--editor-fg, var(--theme-ink)) 55%, transparent)',
      borderRadius: '0.2em',
      margin: '0 1px',
      padding: '0 4px',
      cursor: 'pointer',
    },
    // Bracket matching. The pair is painted by `bracketMatching()`, which is
    // TEXTUAL here — see the note in `extensions.ts` — and the package's own
    // colours are hardcoded hex (`#328c8252`), so they are restated from the
    // palette or this is the one surface that ignores the theme.
    //
    // The FOCUSED rule is spelled with `&.cm-focused` because the package's is
    // `.ͼ1.cm-focused .cm-matchingBracket` — specificity (0,2,0). A bare
    // `.cm-matchingBracket` here is (0,1,1) and LOSES, which is why the editor
    // showed the package's green in a themed app.
    '.cm-matchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--theme-info) 22%, transparent)',
      outlineWidth: '1px',
      outlineStyle: 'solid',
      outlineColor: 'color-mix(in srgb, var(--theme-info) 55%, transparent)',
    },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--theme-info) 30%, transparent)',
    },
    '.cm-nonmatchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--theme-error) 22%, transparent)',
      outlineWidth: '1px',
      outlineStyle: 'solid',
      outlineColor: 'color-mix(in srgb, var(--theme-error) 60%, transparent)',
    },
    '&.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--theme-error) 30%, transparent)',
    },
    // The bracket pair GUIDE: a vertical rule from the caret's brace to its pair.
    //
    // `--bracket-guide-col` is written per LINE by the decoration, and it is the
    // column of the pair's LEFTMOST brace — `const v = merge(base, {` opens at
    // column 20 and its closing brace sits at column 0, so the rule follows the
    // one a reader can see. `ch` is the unit because the surface is monospace on
    // every row.
    //
    // The rule is an absolutely-positioned `::before` on the line rather than a
    // `border-left`, because a border would push the text and a guide must not
    // change the layout. `.cm-line` is `display: block`, so it is the
    // containing block — and an absolute offset resolves against its PADDING
    // box, so `--surface-pad` has to be added back or the rule lands one gutter
    // to the left of the glyph it points at (measured: 750.6 against a brace
    // whose centre is 766.6, exactly the line's 16px padding).
    '.cm-line.cm-bracket-guide': { position: 'relative' },
    '.cm-line.cm-bracket-guide::before': {
      content: '""',
      position: 'absolute',
      top: '0',
      bottom: '0',
      // `+ 0.5ch` centres the 1px rule under the brace glyph instead of at its
      // leading edge.
      left: 'calc(var(--surface-pad, 16px) + var(--bracket-guide-col, 0) * 1ch + 0.5ch)',
      width: '1px',
      backgroundColor: 'color-mix(in srgb, var(--theme-info) 45%, transparent)',
      pointerEvents: 'none',
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
    // The active line. CM6's own colours are hardcoded hex, so they are restated
    // from the palette — the same trap `matchingBracket` documents.
    '.cm-activeLine': {
      backgroundColor: 'var(--editor-active-line, color-mix(in srgb, var(--theme-ink) 4%, transparent))',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--editor-active-line, color-mix(in srgb, var(--theme-ink) 4%, transparent))',
      color: 'var(--editor-fg, var(--theme-ink))',
    },
    // Whitespace marks (`whitespace.ts`): a dot per space and an arrow per tab,
    // drawn only for characters the reader has SELECTED — VS Code's
    // `renderWhitespace: 'selection'`. Nothing is painted for a bare caret.
    //
    // The ink is read from `--editor-fg`, NOT from `currentColor`: a mark that lands
    // inside a Shiki token inherits that token's colour, so the dots in one line
    // would come out in as many colours as the highlighting uses.
    //
    // The dot geometry is the package's own (`.4em`, centred at 55%): a dot wide
    // enough to read at 8px would touch its neighbours at 24px. The tab draws an
    // ARROW rather than a second dot, because one tab and a run of spaces are the
    // same width and must not look alike. The arrow is a MASK, not a background
    // image: an SVG in `url()` is its own document, so `currentColor` inside it
    // resolves to black and the arrow would vanish in a dark theme.
    '.cm-whitespace-space': {
      background:
        'radial-gradient(circle at 50% 55%, var(--editor-fg, var(--theme-ink)) 20%, transparent 0) no-repeat',
      backgroundSize: '.4em',
      backgroundPosition: 'calc(min(50%, 0px)) center',
      opacity: '0.45',
    },
    '.cm-whitespace-tab': {
      backgroundColor: 'var(--editor-fg, var(--theme-ink))',
      maskImage:
        "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"20\"><path stroke=\"%23000\" stroke-width=\"1\" fill=\"none\" d=\"M1 10H196L190 5M190 15L196 10M197 4L197 16\"/></svg>')",
      WebkitMaskImage:
        "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"20\"><path stroke=\"%23000\" stroke-width=\"1\" fill=\"none\" d=\"M1 10H196L190 5M190 15L196 10M197 4L197 16\"/></svg>')",
      maskSize: 'auto 100%',
      WebkitMaskSize: 'auto 100%',
      maskPosition: 'right 90%',
      WebkitMaskPosition: 'right 90%',
      maskRepeat: 'no-repeat',
      WebkitMaskRepeat: 'no-repeat',
      opacity: '0.45',
    },
    // The line-blame label at the end of a run's first line.
    //
    // A WIDGET, so it is drawn beside the text rather than inside it — and it
    // is deliberately the faintest thing on the surface: it is a hint that the
    // line has an answer, not information being read. `user-select: none`
    // because a drag that selected it would put an author's name into a copied
    // snippet of code, and `pointer-events: auto` because it is the hover
    // target the card opens from.
    '.cm-blame-label': {
      marginLeft: '2.5ch',
      color: 'color-mix(in srgb, var(--editor-fg, var(--theme-ink)) 30%, transparent)',
      fontStyle: 'normal',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      cursor: 'help',
      pointerEvents: 'auto',
    },
    '.cm-blame-label:hover': {
      color: 'color-mix(in srgb, var(--editor-fg, var(--theme-ink)) 60%, transparent)',
    },
    // Other occurrences of the selection. Deliberately SUBTLER than a find match:
    // this is a hint about the word under the caret, and on a common identifier it
    // paints a lot of the viewport.
    '.cm-selectionMatch': {
      backgroundColor: 'var(--editor-selection-match, color-mix(in srgb, var(--theme-info) 14%, transparent))',
    },
    // Merge-conflict markers (`conflict-markers.ts`). A LINE decoration, so the
    // whole line is banded rather than the seven characters — the reader is
    // looking for where a block starts, not for a token.
    //
    // Ours and theirs take the two signal colours a diff already uses (removed /
    // added), because that is the same distinction in the same direction; diff3's
    // base section is neutral, since it belongs to neither side.
    '.cm-line.cm-conflict-ours': {
      backgroundColor: 'color-mix(in srgb, var(--theme-error) 12%, transparent)',
      boxShadow: 'inset 2px 0 0 var(--theme-error)',
    },
    '.cm-line.cm-conflict-theirs': {
      backgroundColor: 'color-mix(in srgb, var(--theme-success) 12%, transparent)',
      boxShadow: 'inset 2px 0 0 var(--theme-success)',
    },
    '.cm-line.cm-conflict-base': {
      backgroundColor: 'color-mix(in srgb, var(--theme-ink) 7%, transparent)',
      boxShadow: 'inset 2px 0 0 color-mix(in srgb, var(--theme-ink) 35%, transparent)',
    },
    // Lint. The package ships hardcoded hex for every one of these, so they are
    // restated from the palette — the same trap `matchingBracket` documents.
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--theme-error)',
      textUnderlineOffset: '2px',
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--theme-warning)',
      textUnderlineOffset: '2px',
    },
    '.cm-lint-marker-error': { content: 'none', backgroundColor: 'var(--theme-error)' },
    '.cm-lint-marker-warning': { content: 'none', backgroundColor: 'var(--theme-warning)' },
    '.cm-diagnostic': {
      borderLeftWidth: '3px',
      borderLeftStyle: 'solid',
      borderLeftColor: 'var(--theme-ink)',
      padding: '3px 6px 3px 8px',
      marginLeft: '-1px',
      fontFamily: 'inherit',
    },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--theme-error)' },
    '.cm-diagnostic-warning': { borderLeftColor: 'var(--theme-warning)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--editor-bg, var(--theme-paper))',
      color: 'var(--editor-fg, var(--theme-ink))',
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: 'color-mix(in srgb, var(--theme-ink) 15%, transparent)',
      fontFamily: 'inherit',
    },
  });
}
