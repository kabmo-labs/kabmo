/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { history } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';

import { commentSyntaxFor } from '@/shared/lib/code/editor/comment-syntax';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import { findMarksField } from '@/client/components/common/code-surface/marks';
import { surfaceKeymap } from '@/client/components/common/code-surface/keymap';
import { shikiHighlight, type ShikiThemeNames } from '@/client/components/common/code-surface/shiki';
import { surfaceTheme } from '@/client/components/common/code-surface/theme';

/** Indentation the surface inserts, in spaces. */
const INDENT = '  ';

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
  wordWrap: boolean;
  readOnly: boolean;
  /** The two Shiki theme names this surface tokenizes with. */
  themes: ShikiThemeNames;
  /** Panel-owned commands the editor delegates instead of running. */
  onCommand?: (command: EditorCommand) => void;
  /** Fired for every user edit, with the whole new document. */
  onDocChange: (value: string) => void;
  /** Fired on every state that must be remembered (an edit or a selection move). */
  onState: (state: EditorState) => void;
}

/** Everything the editor needs, built once per document state. */
export function surfaceExtensions({
  language,
  wordWrapCompartment,
  readOnlyCompartment,
  themeCompartment,
  wordWrap,
  readOnly,
  themes,
  onCommand,
  onDocChange,
  onState,
}: SurfaceExtensionsOptions): Extension[] {
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentUnit.of(INDENT),
    // `toggleComment` with no grammar: the tokens are the entire input it needs.
    // The provider must return an object KEYED by the data name —
    // `languageDataAt` looks the name up in each result, so returning the tokens
    // bare yields an empty list and the command silently does nothing.
    EditorState.languageData.of(() => [{ commentTokens: commentTokens(language) }]),
    findMarksField,
    themeCompartment.of(shikiHighlight(language, themes)),
    surfaceTheme(),
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
        const attrs = update.view.contentDOM.dataset;
        attrs.selection = `${range.from},${range.to}`;
        attrs.line = String(update.state.doc.lineAt(range.from).number);
      }
    }),
    surfaceKeymap(onCommand, readOnly),
  ];
}
