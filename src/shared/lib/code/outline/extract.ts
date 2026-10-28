/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A file's outline: the declarations it contains, in source order.
 *
 * **This is a heuristic scanner, not a parser and not LSP.** It exists because
 * Kabmo has no LSP path to a browser: omp's `textDocument/documentSymbol`
 * lives inside the `lsp` TOOL (facing the model), and the RPC bridge the
 * Kabmo drives has no `lsp` command at all — so a precise outline would mean
 * a second language-server client in the server, with its own process
 * management and dependency.
 *
 * **An AST parser is not "the faster option", it is a larger one.** Measured
 * on a 350-line file, this scan takes 0.37–0.51 ms and `ts.createSourceFile`
 * takes 0.26–0.59 ms — a wash, and the AST has parsed one of the 59 language
 * ids the editor can open. Across this repository's 271,109 lines (11 MB) it is
 * 273 ms against 264 ms. So speed does not decide it; coverage and weight do.
 * `typescript` alone is 8.7 MB, and every other language needs its own parser
 * (tree-sitter would mean a WASM grammar per language shipped to the client)
 * for a collapsible panel that needs a name, a kind and a line.
 *
 * What a line scan costs is precision on exotic syntax (a declaration split
 * across lines, one introduced by a macro), and the trade is deliberate: a
 * missing row is honest, a row pointing at the wrong line is not. Names come
 * from the rule's own match indices, never from searching the line, so a line
 * that repeats its own name cannot split a jump.
 *
 * Three invariants keep the depth count true, and each was a defect first:
 *
 * - **Comments and strings are masked before the walk** (`maskSource`). A brace
 *   in a comment or a template literal shifted the depth, and every later
 *   declaration was reported at the wrong level or not at all.
 * - **Only depth 0, and depth 1 inside a scope the file declared, can hold a
 *   declaration.** Without that, a local `const` inside a hook body was
 *   reported as a symbol — 26 of them in one 200-line file.
 * - **A member must not be a keyword.** `for (const viewer of …)` sits at the
 *   body's own depth and matches "name followed by `(`".
 */

export { outlineForPath, scanOutline, SCAN_BY_LANGUAGE, type ScanSpec } from '@/shared/lib/code/outline/scan';

import { scanOutline } from '@/shared/lib/code/outline/scan';
import type { OutlineSymbol } from '@/shared/lib/code/outline/types';

/**
 * The outline of `text`, scanned as `language` (a Shiki id, as the editor
 * resolves it from the file name).
 *
 * A language with no entry in `SCAN_BY_LANGUAGE` answers an empty list rather
 * than a guess: the panel then says the file has no symbols, which is true.
 */
export function extractOutline(text: string, language: string): OutlineSymbol[] {
  return scanOutline(text, language);
}
