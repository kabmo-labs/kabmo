/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Folding and brace detection for the diff bodies.
 *
 * A diff is a READER: the change is what matters and the surrounding block is
 * what gets in the way of comparing it. So the three mechanisms the editor
 * ships are registered here too —
 *
 * - `bracketMatching()` + `bracketGuide`: the pair highlight and the vertical
 *   rule from a brace to its match. This is the open/close DETECTION. With no
 *   parser installed the pairing is TEXTUAL, the same trade the editor makes
 *   (`code-surface/bracket-guide.ts`), so a brace inside a string can pair with
 *   one in another string.
 * - Folding, answered by `foldService` because there is no syntax tree. The
 *   diff's own rule is a BRACE rule followed by the editor's indentation rule:
 *   a line that opens `{` / `[` / `(` and whose match closes on a LATER line
 *   folds down to the line before that closer. The brace rule is first because
 *   it is the exact boundary a reader comparing two sides expects — the closing
 *   brace stays visible and nothing after it is hidden — while indentation is
 *   what still folds a block the brackets cannot describe (YAML, Python, a
 *   wrapped expression).
 * - `foldGutter()`: the marker AND the fold state field. Not `codeFolding()` —
 *   a `foldEffect` dispatched into a state that has no `foldState` field is
 *   discarded with no error (measured in `fold-stack.test.ts`).
 *
 * The chords are `@codemirror/language`'s own `foldKeymap`, so ⌥⌘[ / ⌥⌘] mean
 * the same thing in a diff as in the editor.
 */

import type { EditorState, Extension, Line } from '@codemirror/state';
import { bracketMatching, foldGutter, foldKeymap, foldService } from '@codemirror/language';
import { keymap } from '@codemirror/view';

import { bracketGuide } from '@/client/components/common/code-surface/bracket-guide';
import { indentFoldService, MAX_FOLD_LINES } from '@/client/components/common/code-surface/fold';

/** The brackets a line may open, and what closes each. */
const CLOSERS = { '{': '}', '[': ']', '(': ')' } as const;

type Opener = keyof typeof CLOSERS;

function isOpener(char: string | undefined): char is Opener {
  return char === '{' || char === '[' || char === '(';
}

/**
 * The line holding `column`'s matching closer, or null.
 *
 * A depth counter for the OPENING character's own type only: mixing types in
 * one counter would let an unbalanced `(` swallow a `}`. Quoted strings and
 * comments are not skipped — the scan is textual, like `bracketMatching()`'s —
 * which is the stated trade rather than an oversight.
 *
 * The scan is capped at `MAX_FOLD_LINES` and REFUSES past it instead of
 * returning a range that ends somewhere the reader never chose; the cap is the
 * same cost bound `indentFoldRange` documents (a generated one-block file would
 * otherwise be walked on every gutter line the reader scrolls past).
 */
function closerLineOf(state: EditorState, openerLine: Line, column: number, opener: Opener): Line | null {
  const closer = CLOSERS[opener];
  const lastLineNumber = Math.min(state.doc.lines, openerLine.number + MAX_FOLD_LINES);
  let depth = 0;

  for (let number = openerLine.number; number <= lastLineNumber; number++) {
    const text = state.doc.line(number).text;
    for (let index = number === openerLine.number ? column : 0; index < text.length; index++) {
      const char = text[index];
      if (char === opener) depth += 1;
      else if (char === closer) {
        depth -= 1;
        if (depth === 0) return state.doc.line(number);
      }
    }
  }
  return null;
}

/**
 * The foldable range for the BRACE opened on the line at `lineStart`, or null.
 *
 * Shaped exactly like CM6's `foldService` callback so it can be registered as
 * one; exported separately because the rule is what the tests pin.
 *
 * The first opener that spans lines wins, which is the OUTERMOST one — the
 * block a reader is looking at. A closer on the very next line is skipped: the
 * range would hide nothing, and the next opener (or the indentation rule) is
 * the honest answer.
 */
export function braceFoldRange(
  state: EditorState,
  lineStart: number,
  lineEnd: number,
): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  if (!line.text.trim()) return null;

  for (let column = 0; column < line.text.length; column++) {
    const char = line.text[column];
    if (!isOpener(char)) continue;
    const closerLine = closerLineOf(state, line, column, char);
    // Nothing between the opener's line and the closer's: not a fold.
    if (!closerLine || closerLine.number <= line.number + 1) continue;
    // Ends at the last line INSIDE the pair, so the closing brace stays on
    // screen — the boundary a diff reader is comparing against.
    return { from: lineEnd, to: state.doc.line(closerLine.number - 1).to };
  }
  return null;
}

/** The brace rule as a fold service. */
export const braceFoldService = foldService.of((state, lineStart, lineEnd) =>
  braceFoldRange(state, lineStart, lineEnd),
);

/**
 * Everything both diff shapes register.
 *
 * `braceFoldService` is listed BEFORE `indentFoldService` on purpose: the fold
 * facet hands the question to each provider in order and the FIRST answer wins
 * (`foldable()` in `@codemirror/language`), so the exact brace boundary is
 * preferred and indentation is the fallback.
 */
export const diffFoldingExtensions: Extension[] = [
  bracketMatching(),
  bracketGuide,
  braceFoldService,
  indentFoldService,
  foldGutter(),
  keymap.of(foldKeymap),
];
