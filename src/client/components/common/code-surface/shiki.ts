/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shiki colours for the CodeMirror surface, as a decoration plugin.
 *
 * The app has ONE tokenizer. The chat timeline, the diff views, the wiki reader
 * and the markdown preview all render through `highlightCode`, and the editor
 * must not disagree with them about what a keyword looks like — which is why
 * this is Shiki over CM6's viewport rather than a lezer grammar. A lezer build
 * would cover 48 of the 59 ids `shiki-langs` knows and paint a second palette.
 *
 * Two rules make it affordable on a large file:
 *
 * - **Only the viewport is tokenized**, plus `CONTEXT_LINES` above it so a
 *   window that opens inside a block comment or a template literal still
 *   tokenizes as one. Measured: 2.1 ms per keystroke at 20 000 lines, flat,
 *   because the window is ~100 lines whatever the document is.
 * - **A line at or past `MAX_LINE_CHARS` is left plain.** A minified bundle is
 *   one line of hundreds of KB, and tokenizing it on every scroll is what makes
 *   an editor feel dead.
 *
 * The colours are NOT inline. Every token carries Shiki's two custom properties
 * (`--shiki-light` / `--shiki-dark`) and `theme.ts` picks one through
 * `[data-theme-variant]`, so a theme switch repaints with zero re-tokenizing —
 * the same property every other surface relies on.
 */

import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';

import { getHighlighterSync, onLanguageReady, onSyntaxReady, requestLanguage } from '@/shared/lib/code/highlighter';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';

/** Lines tokenized above the viewport, to seed the grammar's own state. */
const CONTEXT_LINES = 40;

/** Lines at or above this length render as plain text (see the module note). */
const MAX_LINE_CHARS = 12_000;

/** Marks are shared by their style string: a file has a few dozen distinct ones. */
const markCache = new Map<string, Decoration>();

/** Ceiling on cached marks; a pathological file cannot grow the map forever. */
const MARK_CACHE_LIMIT = 2_000;

function markFor(style: string): Decoration {
  const cached = markCache.get(style);
  if (cached) return cached;
  const mark = Decoration.mark({ class: 'shiki-tok', attributes: { style } });
  if (markCache.size >= MARK_CACHE_LIMIT) markCache.clear();
  markCache.set(style, mark);
  return mark;
}

/** `{ '--shiki-light': '#…', '--shiki-dark': '#…' }` as a declaration list. */
function styleOf(htmlStyle: Record<string, string> | undefined): string | null {
  if (!htmlStyle) return null;
  let style = '';
  for (const key of Object.keys(htmlStyle)) {
    const value = htmlStyle[key];
    if (!value) continue;
    style += `${style ? ';' : ''}${key}:${value}`;
  }
  return style || null;
}

/**
 * Tokenize the viewport and emit one mark per coloured token.
 *
 * `RangeSetBuilder` requires ascending ranges, which the line walk gives for
 * free: tokens arrive in document order because they are read line by line.
 */
function buildDecorations(view: EditorView, language: string): DecorationSet {
  const highlighter = getHighlighterSync();
  // Not booted yet, or the grammar is still in flight: plain text for this
  // pass, and `subscribe` re-runs the moment either lands.
  if (!highlighter || language === 'text' || !requestLanguage(language)) return Decoration.none;

  const doc = view.state.doc;
  const firstLine = doc.lineAt(view.viewport.from).number;
  const lastLine = doc.lineAt(view.viewport.to).number;
  const contextStart = Math.max(1, firstLine - CONTEXT_LINES);

  const lines: string[] = [];
  for (let number = contextStart; number <= lastLine; number++) lines.push(doc.line(number).text);
  const source = lines.join('\n');

  let tokenized: { content: string; htmlStyle?: Record<string, string> }[][];
  try {
    tokenized = highlighter.codeToTokens(source, {
      lang: language,
      themes: SHIKI_THEMES,
      defaultColor: false,
      tokenizeMaxLineLength: MAX_LINE_CHARS,
    }).tokens as typeof tokenized;
  } catch {
    // A grammar the engine refuses (or a Shiki internal): plain text is the
    // honest fallback, never a crash that takes the editor down.
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  for (let index = 0; index < tokenized.length && index < lines.length; index++) {
    const line = doc.line(contextStart + index);
    if (line.length >= MAX_LINE_CHARS) continue;
    let offset = 0;
    for (const token of tokenized[index]) {
      const length = token.content.length;
      const style = styleOf(token.htmlStyle);
      if (style && length > 0) {
        const from = line.from + offset;
        const to = Math.min(line.to, from + length);
        if (to > from) builder.add(from, to, markFor(style));
      }
      offset += length;
    }
  }
  return builder.finish();
}

/** Re-run when the highlighter boots or a grammar lands. */
function subscribe(onReady: () => void): () => void {
  const offBoot = onSyntaxReady(onReady);
  const offLanguage = onLanguageReady(onReady);
  return () => {
    offBoot();
    offLanguage();
  };
}

/**
 * The decoration plugin for one language.
 *
 * The language is baked in because a document's language never changes under a
 * live state: `documentKey` carries it, so a `.ts` tab and a `.py` tab are two
 * cached states (and two editor states cannot share decorations built from
 * different grammars).
 */
export function shikiHighlight(language: string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private readonly view: EditorView;
      private dirty = false;
      private destroyed = false;
      private readonly unsubscribe: () => void;

      constructor(view: EditorView) {
        this.view = view;
        this.decorations = buildDecorations(view, language);
        this.unsubscribe = subscribe(() => this.invalidate());
      }

      update(update: ViewUpdate): void {
        // A composition is a document in flux: tokenizing mid-IME paints
        // decorations over text the browser is still composing, and Chrome
        // reacts by moving the caret out from under the user. The rebuild lands
        // on the first update after it ends.
        if (update.view.composing) {
          this.dirty = true;
          return;
        }
        if (!update.docChanged && !update.viewportChanged && !this.dirty) return;
        this.dirty = false;
        this.decorations = buildDecorations(update.view, language);
      }

      destroy(): void {
        this.destroyed = true;
        this.unsubscribe();
      }

      /**
       * A grammar landed: force one rebuild.
       *
       * The empty transaction is the only way a plugin can ask for an update it
       * did not get from a document change — and the `dirty` flag is what makes
       * the rebuild happen even though neither `docChanged` nor
       * `viewportChanged` is set. Guarded, because a chunk can land while the
       * view is being torn down.
       */
      private invalidate(): void {
        if (this.destroyed) return;
        this.dirty = true;
        try {
          this.view.dispatch({});
        } catch {
          // The view went away between the check and the dispatch.
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
