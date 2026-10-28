/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scanning primitives every language table shares: comment/string masking,
 * brace depth, and the shape of one declaration rule.
 *
 * **Masking is not cosmetic, it is what makes the depth count true.** A brace
 * inside a comment or a string (`// {`, `"}"`, a template literal spanning
 * lines) shifted every later declaration by one level, and the only symptom was
 * that half the file's symbols disappeared — the walk stopped reporting
 * top-level declarations because it believed it was inside a body. Masked
 * characters become spaces and newlines survive, so line numbers and columns
 * stay exact.
 *
 * Template literals are masked WHOLE, interpolation included. That is safe
 * because `${ … }` is balanced by construction: blanking both of its braces
 * contributes nothing to the depth, which is all this module needs.
 *
 * The syntax is DATA (`MASK_SYNTAX`), not a switch per language: adding a
 * language means naming its comment markers, never editing the masker.
 */

import type { OutlineKind } from '@/shared/lib/code/outline/types';

/** One rule for a member position (a method, a field). */
export interface MemberRule {
  kind: OutlineKind;
  re: RegExp;
}

export interface DeclarationRule {
  kind: OutlineKind;
  /** Anchored at the line's first non-space character. */
  re: RegExp;
}

/** How a language writes comments and strings. */
export interface MaskSyntax {
  /** Prefixes that comment out the rest of the line (`//`, `#`, `--`, `;`, `%`). */
  line: readonly string[];
  /** An open/close pair for a block comment (`/*` + `*\/`, `{-` + `-}`, `--[[` + `]]`). */
  block?: readonly [string, string];
  /** Quote characters that open a string closed by the same character. */
  quotes?: readonly string[];
  /** A backtick opens a literal that may span lines (JS/TS template). */
  template?: boolean;
  /** Three of the same quote open a multi-line literal (Python docstrings). */
  triple?: boolean;
}

export type MaskStyle =
  | 'c'
  | 'css'
  | 'python'
  | 'hash'
  | 'dash'
  | 'lua'
  | 'sql'
  | 'ml'
  | 'hcl'
  | 'percent'
  | 'lisp'
  | 'none'
  | 'raw';

/** The comment/string syntax of each masking style, as one table. */
export const MASK_SYNTAX: Record<MaskStyle, MaskSyntax> = {
  c: { line: ['//'], block: ['/*', '*/'], quotes: ["'", '"'], template: true },
  // CSS has no `//`; a `url(//cdn…)` is a string, not a comment.
  css: { line: [], block: ['/*', '*/'], quotes: ["'", '"'] },
  python: { line: ['#'], quotes: ["'", '"'], triple: true },
  hash: { line: ['#'], quotes: ["'", '"'] },
  dash: { line: ['--'], quotes: ["'", '"'] },
  lua: { line: ['--'], block: ['--[[', ']]'], quotes: ["'", '"'] },
  sql: { line: ['--'], block: ['/*', '*/'], quotes: ["'", '"'] },
  ml: { line: [], block: ['(*', '*)'], quotes: ['"'] },
  // HCL/Terraform accepts all three comment forms. Quotes are NOT masked:
  // a resource's label is a quoted string, and the outline reports it.
  hcl: { line: ['#', '//'], block: ['/*', '*/'], quotes: [] },
  percent: { line: ['%'], quotes: ["'", '"'] },
  lisp: { line: [';'], block: ['#|', '|#'], quotes: ['"'] },
  none: { line: [], quotes: ['"', "'"] },
  // Nothing is masked. JSON keys and HTML attributes ARE quoted strings, so a
  // quote mask would erase exactly the text an outline reports.
  raw: { line: [], quotes: [] },
};

type MaskState = 'code' | 'line' | 'block' | 'quoted' | 'template' | 'triple';

/**
 * Blank every comment and string literal, keeping line breaks and columns.
 */
export function maskSource(lines: readonly string[], style: MaskStyle): string[] {
  const syntax = MASK_SYNTAX[style];
  const [blockOpen, blockClose] = syntax.block ?? ['', ''];
  const out: string[] = [];
  let state: MaskState = 'code';
  let quote = '';

  for (const line of lines) {
    let masked = '';
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];

      if (state === 'line') {
        masked += ' ';
        continue;
      }
      if (state === 'block') {
        if (blockClose && char === blockClose[0] && line.startsWith(blockClose, i)) {
          state = 'code';
          masked += ' '.repeat(blockClose.length);
          i += blockClose.length - 1;
          continue;
        }
        masked += ' ';
        continue;
      }
      if (state === 'quoted' || state === 'template' || state === 'triple') {
        if (char === '\\') {
          masked += '  ';
          i += 1;
          continue;
        }
        if (state === 'triple') {
          if (char === quote && line.startsWith(quote.repeat(3), i)) {
            state = 'code';
            masked += '   ';
            i += 2;
            continue;
          }
          masked += ' ';
          continue;
        }
        masked += ' ';
        if (char === quote) state = 'code';
        continue;
      }

      // code
      const linePrefix = syntax.line.find((prefix) => line.startsWith(prefix, i));
      if (linePrefix) {
        state = 'line';
        masked += ' '.repeat(linePrefix.length);
        i += linePrefix.length - 1;
        continue;
      }
      if (blockOpen && line.startsWith(blockOpen, i)) {
        state = 'block';
        masked += ' '.repeat(blockOpen.length);
        i += blockOpen.length - 1;
        continue;
      }
      if (syntax.triple && char === (next ?? '') && char === line[i + 2] && (char === "'" || char === '"')) {
        state = 'triple';
        quote = char;
        masked += '   ';
        i += 2;
        continue;
      }
      if (syntax.template && char === '`') {
        state = 'template';
        quote = '`';
        masked += ' ';
        continue;
      }
      if (syntax.quotes?.includes(char)) {
        state = 'quoted';
        quote = char;
        masked += ' ';
        continue;
      }
      masked += char;
    }
    // A single-line comment or a one-line string cannot cross a newline; an
    // unterminated one is a scan artifact, not a state to carry.
    if (state === 'line' || state === 'quoted') state = 'code';
    out.push(masked);
  }
  return out;
}

/** Net brace depth a masked line opens (`{` minus `}`). */
export function braceDelta(line: string): number {
  let depth = 0;
  for (const char of line) {
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
  }
  return depth;
}

/** The indentation width of a line, with tabs counted as four columns. */
export function indentWidth(line: string): number {
  const leading = /^[ \t]*/.exec(line)![0];
  let width = 0;
  for (const char of leading) width += char === '\t' ? 4 : 1;
  return width;
}

/**
 * TypeScript / JavaScript declarations, matched against a TRIMMED line.
 *
 * Order is the decision: an arrow function assigned to a `const` must be
 * reported as a function before the constant rule can claim it, and a class
 * before the `declare`-style forms. A destructuring declaration
 * (`const { a, b } = …`) matches nothing, which is deliberate — it names no
 * single symbol.
 */
export const TS_RULES: readonly DeclarationRule[] = [
  { kind: 'class', re: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:declare\s+)?class\s+([A-Za-z_$][\w$]*)/d },
  { kind: 'interface', re: /^(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/d },
  { kind: 'type', re: /^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/d },
  { kind: 'enum', re: /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/d },
  { kind: 'module', re: /^(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$]*)/d },
  { kind: 'function', re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/d },
  {
    kind: 'function',
    re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/d,
  },
  { kind: 'constant', re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/d },
];

/**
 * A class/impl member. Deliberately anchored on a NAME followed by `(`, so a
 * statement inside a method body (`for (const viewer of …)`) cannot match —
 * members are only looked for at the body's own depth, but the keyword filter
 * below is the second guard and the one the prototype needed: `for` and `if`
 * were reported as methods without it.
 */
export const TS_METHOD_RE =
  /^(?:(?:public|private|protected|static|async|readonly|override|abstract|declare|get|set)\s+)*(?:\*|#)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/d;

/** A class field holding an arrow function. */
export const TS_FIELD_FUNCTION_RE =
  /^(?:(?:public|private|protected|static|readonly|override|declare)\s+)*(?:#)?([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/d;

/** A class field of any other kind (`readonly foo: string;`, `count = 0`). */
export const TS_FIELD_RE =
  /^(?:(?:public|private|protected|static|readonly|override|declare)\s+)*(?:#)?([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?(?:=[^>]|;)/d;

/** The member rules, in the order they are tried: method, arrow field, field. */
export const TS_MEMBER_RULES: readonly MemberRule[] = [
  { kind: 'method', re: TS_METHOD_RE },
  { kind: 'method', re: TS_FIELD_FUNCTION_RE },
  { kind: 'variable', re: TS_FIELD_RE },
];

/**
 * Names that look like a call but are control flow, never a member.
 *
 * `boolean` rather than the literal `true`: `constructor` is a key every object
 * literal inherits, and TypeScript types the literal's own `constructor` as the
 * inherited member rather than as `true` (`TS2322: Type 'boolean' is not
 * assignable to type 'true'`). Lookups compare with `=== true`, which is also
 * what keeps an inherited name (`toString`) from reading as a member of this
 * table at runtime.
 */
export const TS_NON_MEMBER: Record<string, boolean> = {
  if: true,
  for: true,
  while: true,
  switch: true,
  catch: true,
  return: true,
  function: true,
  else: true,
  do: true,
  try: true,
  with: true,
  new: true,
  typeof: true,
  await: true,
  yield: true,
  super: true,
  this: true,
  delete: true,
  void: true,
  throw: true,
  constructor: true,
};
