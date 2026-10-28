/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One entry of a file's outline, and the vocabulary every surface shares.
 *
 * The kinds are a CLOSED set because each one is a row in the icon table
 * (`outline/kinds.tsx`): a kind added here without an icon would draw a
 * fallback mark on every surface that renders an outline, so the table and this
 * union are asserted against each other by a test rather than by memory.
 *
 * `line` is 1-based, which is what every caller speaks — the editor's reveal
 * store, a symbol row's own label, and a jump target compared against a
 * document's line count.
 */
export type OutlineKind =
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'function'
  | 'method'
  | 'constant'
  | 'variable'
  | 'struct'
  | 'trait'
  | 'impl'
  | 'module'
  | 'heading'
  | 'selector'
  | 'key'
  | 'tag'
  | 'macro';

export interface OutlineSymbol {
  /** The declared name, as written (a markdown heading keeps its text). */
  name: string;
  kind: OutlineKind;
  /** 1-based line in the document the symbol was read from. */
  line: number;
  /**
   * 1-based column where the NAME starts on that line.
   *
   * This is what makes a row click land ON the declaration: the editor selects
   * `column … column + name.length`, so the reader sees the identifier picked
   * out rather than a bare caret at the start of the line (which, on an
   * `export class Widget {` line, is the word `export`).
   *
   * The column comes from the rule's own match indices (`d` flag) plus the
   * line's indentation, never from searching the line for the name — a line
   * that mentions its own name earlier (`const count = count + 1`) would match
   * the wrong occurrence.
   */
  column: number;
  /**
   * Nesting level the row is drawn at: 0 for a top-level declaration, 1 for a
   * member of a class/impl, 2+ for a heading's own depth.
   *
   * It is the OUTLINE's depth, not the source's — the extractor never reports a
   * local variable or a nested closure, so a level here always means "this
   * belongs to the declaration above it".
   */
  depth: number;
}

/** Every kind, in the order the icon table documents them. */
export const OUTLINE_KINDS: readonly OutlineKind[] = [
  'class',
  'interface',
  'type',
  'enum',
  'function',
  'method',
  'constant',
  'variable',
  'struct',
  'trait',
  'impl',
  'module',
  'heading',
  'selector',
  'key',
  'tag',
  'macro',
];
