/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The code surface's extension stack, in one place.
 *
 * Split from the component because the mount and the configuration are two
 * different concerns, and because this is the list a reader checks when asking
 * "what does this editor do". Each entry is here for a reason worth stating:
 *
 * - `history()` replaces the hand-rolled undo stack. It is per `EditorState`,
 *   and every document gets its own (see `documents.ts`), so history is already
 *   isolated per tab.
 * - `drawSelection()` paints the selection and the multi-cursor bands. Without
 *   it a second cursor from `⌘D` is a state change with nothing on screen.
 * - `rectangularSelection` / `crosshairCursor` are CM6's own answer to a column
 *   selection; the textarea surface could not do one at all.
 * - `languageData` carries the comment tokens, which is the whole of what
 *   `toggleComment` needs — no lezer grammar, no syntax tree. It is read from
 *   the same table the old text commands used, so `#` stays right in YAML and
 *   `/* *\/` stays right in CSS.
 * - Read-only is BOTH facets: `readOnly` stops the commands, `editable(false)`
 *   sets `contenteditable=false`, and only the pair makes a viewer a viewer
 *   (measured: `readOnly` alone let a programmatic `dispatch({changes})` through,
 *   which a viewer has no business accepting).
 *
 * `wordWrap` and `readOnly` arrive as compartments because they are per-view
 * settings that must reconfigure a live editor without re-creating it — a
 * reconfigure keeps the document, the selection and the history, which is
 * exactly what a wrap toggle must not disturb.
 */

import { type Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  lineNumbers,
  placeholder as placeholderExtension,
  rectangularSelection,
  scrollPastEnd,
} from '@codemirror/view';
import { highlightSelectionMatches } from '@codemirror/search';
import { history } from '@codemirror/commands';
import { bracketMatching, codeFolding, foldGutter, indentUnit } from '@codemirror/language';

import { commentSyntaxFor } from '@/shared/lib/code/editor/comment-syntax';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import { bracketGuide } from '@/client/components/common/code-surface/bracket-guide';
import { indentDataExtension, indentExtensions } from '@/client/components/common/code-surface/indent';
import { typingExtensions, type EditorTypingOptions } from '@/client/components/common/code-surface/typing';
import { indentFoldService } from '@/client/components/common/code-surface/fold';
import { foldPlaceholderDom } from '@/client/components/common/code-surface/fold-placeholder';
import { indentGuides } from '@/client/components/common/code-surface/indent-guide';
import { findMarksField } from '@/client/components/common/code-surface/marks';
import { surfaceKeymap } from '@/client/components/common/code-surface/keymap';
import { shikiHighlight, type ShikiThemeNames } from '@/client/components/common/code-surface/shiki';
import { surfaceTheme } from '@/client/components/common/code-surface/theme';
import { conflictMarkers } from '@/client/components/common/code-surface/conflict-markers';
import { lintExtensions } from '@/client/components/common/code-surface/lint';
import { reportEditorError } from '@/client/lib/editor-errors';

/**
 * The indentation facets, in one extension.
 *
 * `indentUnit` is what a LEVEL is; `EditorState.tabSize` is what a literal TAB
 * character counts as. They travel together because a tab-indented setting makes
 * them the same number (one tab per level), and a reconfigure of one without the
 * other would measure a level wrong.
 */
export function indentExtension(indentUnitText: string): Extension {
  return [indentUnit.of(indentUnitText), EditorState.tabSize.of(indentUnitText === '\t' ? 1 : indentUnitText.length)];
}

/** Wrap on: CM6 wraps the content box; the panel no longer measures anything. */
export function wrapExtension(wordWrap: boolean): Extension {
  return wordWrap ? EditorView.lineWrapping : [];
}

/** Both halves of read-only, or nothing for an editable surface. */
export function readOnlyExtension(readOnly: boolean): Extension {
  return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
}

/** The comment tokens `toggleComment` reads out of `languageData`. */
function commentTokens(language: string): { line?: string; block?: { open: string; close: string } } {
  const syntax = commentSyntaxFor(language);
  if ('line' in syntax) return { line: syntax.line };
  return { block: { open: syntax.block[0], close: syntax.block[1] } };
}

export interface SurfaceExtensionsOptions {
  language: string;
  /** Compartment holding `wrapExtension`. */
  wordWrapCompartment: Compartment;
  /** Compartment holding `readOnlyExtension`. */
  readOnlyCompartment: Compartment;
  /**
   * Compartment holding the tokenizer.
   *
   * The editor theme is baked into the decoration plugin (Shiki is handed the
   * theme NAMES at tokenize time), so a theme change reconfigures this — which
   * rebuilds the plugin while the document, the selection and the history stay
   * exactly where they were.
   */
  themeCompartment: Compartment;
  /**
   * Compartment holding the stream language, when one has loaded.
   *
   * Empty on mount: the mode is a lazy import (`stream-language.ts`), so the
   * surface starts with no parser and the compartment is reconfigured when the
   * module lands. That reconfigure keeps the document, the selection and the
   * history — it only swaps the language — which is why it is a compartment and
   * not a re-mount.
   */
  languageCompartment: Compartment;
  /**
   * Compartment holding the indentation unit.
   *
   * A compartment rather than a value baked into the state, because the setting can
   * change while a document is open and a re-mount would drop the undo history. The
   * indent service reads it through `ctx.unit`, so one reconfigure moves every rule
   * that emits an indent — including the tab-size the gutter measures with.
   */
  indentCompartment: Compartment;
  /**
   * Compartment holding auto-close and the completer.
   *
   * A compartment because both are BEHAVIOUR settings that can change while a document is
   * open; a re-mount would drop the undo history for a preference.
   */
  typingCompartment: Compartment;
  wordWrap: boolean;
  readOnly: boolean;
  /** The two Shiki theme names this surface tokenizes with. */
  themes: ShikiThemeNames;
  /**
   * Auto-close brackets and the document-words completer.
   *
   * BEHAVIOUR, not view: both change what typing does, so both are settings and both
   * arrive as a value rather than being always-on.
   */
  typing: EditorTypingOptions;
  /**
   * One indentation level, as a whitespace string — `indentUnit.of`'s own shape.
   *
   * `'  '` by default; `'    '` or `'\t'` from the setting. The surface no longer
   * carries its own constant: a 4-space repository was being indented by 2.
   */
  indentUnitText: string;
  /** Panel-owned commands the editor delegates instead of running. */
  onCommand?: (command: EditorCommand) => void;
  /**
   * Line blame: the labels, the field they read and the card — or null.
   *
   * One extension value rather than a set of options, because the three are one
   * feature and the surface has nothing to decide about them. `null` is "off",
   * which is the default: the blame costs a server read per file, so it is
   * opt-in.
   */
  blame?: Extension | null;
  /** Compartment holding the blame extension, so the toggle is a reconfigure. */
  blameCompartment: Compartment;
  /** Fired for every user edit, with the whole new document. */
  onDocChange: (value: string) => void;
  /** Fired on every state that must be remembered (an edit or a selection move). */
  onState: (state: EditorState) => void;
  /**
   * Fired with the caret's line and column whenever either moves.
   *
   * A separate channel from `onState` because the two have different lifetimes:
   * `onState` feeds a per-document cache (and is dropped when the tab closes), while
   * a status readout wants two numbers and nothing else — keeping the state there
   * would pin a whole document snapshot in a component that prints its line number.
   */
  onCaret?: (position: { line: number; column: number }) => void;
  /**
   * Text shown while the document is empty, or absent for none.
   *
   * A file that exists and holds nothing is a different fact from "no file is
   * open" (which the panel's `EmptyEditor` draws), and a blank surface said
   * neither: it looked like a read that had not finished.
   */
  placeholder?: string;
}

/** Everything the editor needs, built once per document state. */
export function surfaceExtensions({
  language,
  wordWrapCompartment,
  readOnlyCompartment,
  themeCompartment,
  languageCompartment,
  indentCompartment,
  typingCompartment,
  wordWrap,
  readOnly,
  themes,
  typing,
  indentUnitText,
  blame,
  blameCompartment,
  onCommand,
  onDocChange,
  onState,
  onCaret,
  placeholder,
}: SurfaceExtensionsOptions): Extension[] {
  return [
    lineNumbers(),
    // The active line, so a long file says where the caret is without counting.
    // Both halves: the line band and the gutter row, or the number and the row it
    // belongs to disagree about which line is current.
    highlightActiveLine(),
    highlightActiveLineGutter(),
    // Other occurrences of the selection. Capped by the package, and the band is
    // subtler than the find mark's — this is a hint, not a result.
    highlightSelectionMatches(),
    // Room to scroll past the last line, so the end of a file can be centred
    // instead of pinned to the bottom edge.
    scrollPastEnd(),
    // Control characters drawn as their glyph instead of nothing: a stray NUL or a
    // zero-width space is invisible, which makes a corrupted file look fine.
    highlightSpecialChars(),
    // A rule at every nesting level, from indentation (there is no tree). Deliberately
    // dimmer than `bracketGuide`, which draws ONE line between a brace and its pair.
    indentGuides,
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentCompartment.of(indentExtension(indentUnitText)),
    // The stream language, when one has loaded. It goes BEFORE the manual
    // `languageData` table below because `languageDataAt` returns every
    // provider's answer in order and the commands take the FIRST — measured: a
    // mode first makes `toggleComment` use the mode's own tokens, while the
    // manual table first overrides them (a wrong manual entry won and `##`
    // commented a Rust line).
    //
    // The tree it builds is what makes bracket matching token-aware. A lezer
    // grammar would too, and was rejected on measurement: +39 KB gzip for
    // JavaScript alone, 24 of 59 languages, and WRONG until its lazy parse
    // catches up (3 wrong pairs at mount on a 176-line file).
    languageCompartment.of([]),
    // `toggleComment` with no mode loaded: the tokens are the entire input it
    // needs. The provider must return an object KEYED by the data name —
    // `languageDataAt` looks the name up in each result, so returning the tokens
    // bare yields an empty list and the command silently does nothing.
    EditorState.languageData.of(() => [{ commentTokens: commentTokens(language) }]),
    // Auto-indent, in two parts. `indentOnInput()` reaches the MODE's own
    // `indentOnInput` regexp where one exists (27 of the 48 modes ship one), and
    // the service answers for the 26 languages whose parser answers nothing —
    // it returns `undefined` for the rest, which is what lets the mode win.
    // The data entry is appended AFTER the manual table for the same
    // first-answer-wins reason the mode sits before it: a language with a rule
    // of its own must not be shadowed by a generic one.
    ...indentExtensions(language),
    indentDataExtension(language),
    // Auto-close brackets and the completer. Empty when both settings are off, which is
    // why this is a spread rather than a condition at the call site.
    typingCompartment.of(typingExtensions(typing)),
    // The parser's verdict for a config format, and the gutter that marks it.
    // Empty for every other language, which is why this is a spread.
    ...lintExtensions(language),
    // Merge-conflict markers, painted where a reader resolving one by hand
    // meets them. Viewport-scoped, so an unconflicted file pays one scan of the
    // visible lines and nothing else.
    conflictMarkers(),
    findMarksField,
    // Bracket matching, plus the vertical guide from the caret's brace to its
    // pair. With a stream language loaded the pairing is token-aware; without
    // one it is TEXTUAL, which is right for code and wrong inside a string
    // (`const a = "{";` … `const c = "}"` pairs the two). The guide reads the
    // same `matchBrackets` call, so the line and the highlight cannot disagree.
    bracketMatching(),
    bracketGuide,
    // Folding, on the same reasoning: `foldGutter` supplies the gutter markers
    // and their click, `indentFoldService` answers "is this line foldable" from
    // indentation because `foldNodeProp` needs a tree. `foldGutter` already
    // includes `codeFolding()`, so a `foldEffect` dispatched without it would be
    // dropped silently — verified: no placeholder, no error.
    indentFoldService,
    foldGutter(),
    // `foldGutter()` brings `codeFolding()` with its package placeholder, which
    // WebKit loses to the editor's own mouse selection — see
    // `fold-placeholder.ts` for the measurement. A later config wins in
    // `combineConfig`, so this one replaces the package default.
    codeFolding({ placeholderDOM: foldPlaceholderDom }),
    themeCompartment.of(shikiHighlight(language, themes)),
    surfaceTheme(),
    // Line blame, when the panel turned it on: the labels, the state field they
    // read, and the card. In a compartment because the toggle can be pressed
    // while a document is open, and a reconfigure keeps its undo history —
    // `null` is the off state, and CM6 wants an empty list for it.
    blameCompartment.of(blame ?? []),
    wordWrapCompartment.of(wrapExtension(wordWrap)),
    readOnlyCompartment.of(readOnlyExtension(readOnly)),
    // The browser's own spellchecker underlines every identifier and offers to
    // "correct" them; autocapitalise/autocorrect mangle code on a phone. CM6
    // sets these itself, and stating them keeps a future default from silently
    // regressing a mobile keyboard.
    EditorView.contentAttributes.of({
      spellcheck: 'false',
      autocorrect: 'off',
      autocapitalize: 'off',
      translate: 'no',
    }),
    EditorView.updateListener.of((update) => {
      // The per-tab cache stores the LIVE state so a switch back finds its
      // caret: a selection move is as much of that state as an edit is.
      if (update.docChanged || update.selectionSet) onState(update.state);
      if (update.docChanged) onDocChange(update.state.doc.toString());
      // The selection as a DOM fact, because a `contenteditable` exposes none.
      // The old surface was a `<textarea>`, whose `selectionStart`/`selectionEnd`
      // and line arithmetic were readable from the element; these two attributes
      // are the same facts for the same readers (the e2e layer's outline and
      // caret specs), and nothing in the app reads them.
      if (update.docChanged || update.selectionSet) {
        const range = update.state.selection.main;
        const line = update.state.doc.lineAt(range.from);
        const attrs = update.view.contentDOM.dataset;
        attrs.selection = `${range.from},${range.to}`;
        attrs.line = String(line.number);
        // 1-based on both axes, and the column counts CHARACTERS — which is what an
        // editor's `Col` shows and what the user's own selection arithmetic gives.
        onCaret?.({ line: line.number, column: range.from - line.from + 1 });
      }
    }),
    surfaceKeymap(onCommand, readOnly),
    // An empty document says so, rather than looking like a read still running.
    placeholder ? placeholderExtension(placeholder) : [],
    // A plugin that throws is caught by CodeMirror and, by default, only reaches
    // the console — which in a diagnostic workbench is a feature that silently
    // stopped drawing. `reportEditorError` dedupes and raises a toast.
    EditorView.exceptionSink.of((error) => reportEditorError(error)),
  ];
}
