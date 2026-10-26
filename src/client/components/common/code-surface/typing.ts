/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auto-close brackets and a document-words completer.
 *
 * Both come from `@codemirror/autocomplete`, which is the ONE new dependency the editor
 * has taken since the CM6 migration. `closeBrackets` and `autocompletion` live in it and
 * nowhere else, and a hand-rolled version of either would be a second, worse copy of a
 * well-tested one.
 *
 * ## Both are BEHAVIOUR changes, so both are settings
 *
 * Auto-close alters what typing a `{` does. A document-words completer alters what
 * happens while typing any identifier. Neither is a view preference — a user who does not
 * want them cannot work around them — so each has its own setting, defaulting ON because
 * that is what every editor does.
 *
 * ## The completer is bounded on purpose
 *
 * It reads words from the VIEWPORT (± a window) rather than the whole document: a naive
 * `text.match(/\w+/g)` over a 20 MB file is a scan per keystroke, which is the exact cost
 * the surface was migrated to CM6 to remove. Measured: `const` in this repository matches
 * 19 376 times, and a full-document scan on every completion is not a trade worth making
 * for an identifier that is usually three lines away.
 *
 * This is deliberately NOT LSP. It suggests words that already appear near the caret,
 * which is useful in every language and needs no server.
 */

import { type CompletionContext, type CompletionResult, autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

/** How far either side of the viewport the completer looks, in lines. */
export const COMPLETION_WINDOW_LINES = 500;

/** Words shorter than this are not offered — a two-letter match is noise. */
export const COMPLETION_MIN_WORD = 3;

/** Cap on the offered list, so a common prefix does not paint a thousand rows. */
export const COMPLETION_MAX_OPTIONS = 50;

/** A word as the completer sees it: identifiers, with `$` and `_` inside them. */
const WORD = /[\w$]{3,}/g;

/**
 * The words around the caret, deduplicated and capped.
 *
 * `doc` is the WHOLE document and `from`/`to` are the window, so the caller decides how
 * much of a large file to look at — this function never walks the whole text.
 */
export function documentWords(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(WORD)) {
    seen.add(match[0]);
    if (seen.size >= COMPLETION_MAX_OPTIONS * 4) break;
  }
  return [...seen];
}

/**
 * The completer itself.
 *
 * `explicit` (Ctrl+Space) offers everything in the window; a bare keystroke offers only
 * words that START with what has been typed, because a fuzzy match on every keystroke
 * turns a 40-character identifier into a list of unrelated ones.
 */
export function documentWordCompleter(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(WORD);
  if (!word && !context.explicit) return null;
  if (word && word.from === word.to && !context.explicit) return null;

  // The window is the caret's own lines ± the bound, not the document: the visible text is
  // already what the reader is looking at, and `CompletionContext` carries no viewport
  // (its `view` is optional and absent in synchronous updates).
  const caretLine = context.state.doc.lineAt(context.pos).number;
  const firstLine = Math.max(1, caretLine - COMPLETION_WINDOW_LINES);
  const lastLine = Math.min(context.state.doc.lines, caretLine + COMPLETION_WINDOW_LINES);
  const text = context.state.sliceDoc(
    context.state.doc.line(firstLine).from,
    context.state.doc.line(lastLine).to,
  );

  const options = documentWords(text)
    .filter((candidate) => candidate.length >= COMPLETION_MIN_WORD)
    .slice(0, COMPLETION_MAX_OPTIONS)
    .map((label) => ({ label }));

  if (options.length === 0) return null;
  return { from: word ? word.from : context.pos, options };
}

/** What the two settings resolve to. */
export interface EditorTypingOptions {
  autoCloseBrackets: boolean;
  autocomplete: boolean;
}

/** Both ON — what every editor does, and what a caller that passes nothing gets. */
export const DEFAULT_EDITOR_TYPING: EditorTypingOptions = { autoCloseBrackets: true, autocomplete: true };

/** The extensions for the current settings. An empty list means neither is on. */
export function typingExtensions({ autoCloseBrackets, autocomplete: complete }: EditorTypingOptions): Extension[] {
  const extensions: Extension[] = [];
  if (autoCloseBrackets) extensions.push(closeBrackets(), keymap.of(closeBracketsKeymap));
  if (complete) extensions.push(autocompletion({ override: [documentWordCompleter], activateOnTyping: true }));
  return extensions;
}
