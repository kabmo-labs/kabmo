/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Auto-indent: the fallback for the questions a language's parser cannot answer,
 * plus the `indentOnInput` wiring that makes a typed closer dedent.
 *
 * ## Two halves, and both are required
 *
 * Measured with the surface's own extension set (`indentUnit` + the stream mode):
 *
 * - `indentService` alone: Enter indents where the TABLE has an `opens` rule, and
 *   a typed closer does nothing — nothing re-runs the service on input.
 * - `indentOnInput()` alone: a typed closer dedents only in the languages whose
 *   MODE ships a regexp that matches OUR indentation (27 do; `go`'s demands
 *   exactly one space and so never matches `  }`).
 * - Neither: 26 languages indent nothing on Enter, and nothing dedents anywhere.
 *
 * ## The service must return `undefined`, never `null`
 *
 * `getIndentation` iterates the `indentService` facet and returns the first result
 * that is not `undefined`; returning `null` SWALLOWS the answer and the parser is
 * never consulted. Measured:
 *
 * ```
 * js, service returns a number   -> 0    (overrides the mode's 11)
 * js, service returns undefined  -> 11   (falls through to the mode)
 * js, service returns null       -> null (swallows the mode's answer)
 * ```
 *
 * So the two questions are answered INDEPENDENTLY: a closer is dedented even in a
 * language whose mode handles Enter (`go`), and Enter falls through to the mode
 * wherever the table has no `opens` rule.
 *
 * ## The unit comes from the state, not from a constant
 *
 * `ctx.unit` is `getIndentUnit(state)`, which reads the `indentUnit` facet — so a
 * tab-size setting propagates here with no second table and no reconfigure.
 */

import { EditorState, type Extension } from '@codemirror/state';
import { type IndentContext, indentOnInput, indentService } from '@codemirror/language';

import {
  hasIndentRule,
  indentAfter,
  indentForCloser,
  indentOnInputPattern,
} from '@/shared/lib/code/editor/indent-rules';

/**
 * How many lines back a blank line is skipped when looking for the line that
 * decides the indent.
 *
 * A cap, not a preference: 400 blank lines would otherwise be walked on every
 * Enter. Past this the service declines and the parser answers.
 */
const MAX_BLANK_SKIP = 200;

/**
 * The `indentService` for one language.
 *
 * Reads through `IndentContext`, never `state.doc`: while `insertNewlineAndIndent`
 * runs, the context SIMULATES the line break, so `lineAt(pos, -1)` is the text
 * before the break while `state.doc` still holds the caret on the line being
 * broken. Reading the document there answers the wrong question.
 *
 * Also note `lineAt` returns `{ text, from }` — NOT a `Line`. A walk-back written
 * against `line.number` exits after one step (`undefined > 1` is false) and
 * silently stops on the first blank line.
 */
function serviceFor(language: string) {
  return (context: IndentContext, pos: number): number | undefined => {
    // Nothing to say: the parser (or nothing) owns both questions.
    if (!hasIndentRule(language)) return undefined;

    let line = context.lineAt(pos, -1);
    // A blank line inside a block keeps the block's indent: the line that decides
    // is the previous one with content.
    for (let skipped = 0; skipped < MAX_BLANK_SKIP && !line.text.trim() && line.from > 0; skipped++) {
      line = context.lineAt(Math.max(0, line.from - 1), -1);
    }
    if (!line.text.trim()) return undefined;

    // A line that IS a closer is `indentOnInput`'s question: dedent it. Answered
    // even where the mode handles Enter, which is what fixes `go`'s strict regexp.
    const dedented = indentForCloser(language, line.text, context.unit);
    if (dedented !== null) return dedented;

    // Otherwise it is Enter's: what should follow this text? `undefined` when this
    // language has no `opens` rule, so the mode keeps its own answer.
    return indentAfter(language, line.text, context.unit) ?? undefined;
  };
}

/**
 * The language-data entries for this language.
 *
 * Empty for a language with no closer rule — `null` is the honest answer where a
 * `}` is content (YAML, Markdown, SQL), and measured: the generic bracket pattern
 * turned `a:\n  }` into `a:\n}`.
 */
export function indentLanguageData(language: string): { indentOnInput: RegExp }[] {
  const pattern = indentOnInputPattern(language);
  return pattern ? [{ indentOnInput: pattern }] : [];
}

/**
 * The input reindent plus the fallback service.
 *
 * `indentOnInput()` is installed for EVERY language, including the ones with no
 * table row: it is what reaches the MODE's own `indentOnInput` regexp, which 27 of
 * the 48 modes ship.
 */
export function indentExtensions(language: string): Extension[] {
  return [indentOnInput(), indentService.of(serviceFor(language))];
}

/** The language-data provider, ready to append to the surface's table. */
export function indentDataExtension(language: string): Extension {
  return EditorState.languageData.of(() => indentLanguageData(language));
}
