/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The parsers behind the editor's lint, loaded per language.
 *
 * Three formats, three parsers, and none of them is in the main bundle.
 *
 * **Why these are `import()` and not static imports**, which is the exception
 * this file takes to the usual rule: a static import puts every parser in the
 * main bundle, and all three measure ~46 KB gzip together (yaml 32.3,
 * jsonc-parser 6.8, smol-toml 6.9) — in a repository that rejected a lezer
 * grammar at 39 KB for exactly this reason (`stream-modes.ts`). A tab opened on
 * a README must not pay for a TOML parser, so each arrives the first time a
 * document in its language is linted. The specifier is known at author time;
 * the TIMING is what is deferred, and only a call site can defer it.
 *
 * **Literal specifiers only.** A template-literal specifier builds fine and
 * never resolves in the dev server (the same trap `stream-modes.ts` documents),
 * so the switch below is spelled out per kind.
 *
 * Every parser reports a range in DOCUMENT OFFSETS, which is what a
 * `Diagnostic` needs. Each one answers that differently — jsonc-parser already
 * speaks offsets, YAML gives `[start, end]`, TOML gives a 1-based line and
 * column — and the conversion lives here so `lint.ts` has one shape to read.
 */

import type { ParseError } from 'jsonc-parser';

import { lineStartOffset } from '@/shared/lib/code/editor/lines';

/** The formats this build can lint. */
export type ParserKind = 'json' | 'yaml' | 'toml';

/** One problem, as a half-open document range and the sentence to show. */
export interface ParseProblem {
  from: number;
  to: number;
  message: string;
  severity: 'error' | 'warning';
}

/** Which parser answers for a Shiki language id, or null when none does. */
export function parserKindFor(language: string): ParserKind | null {
  if (language === 'json') return 'json';
  if (language === 'yaml') return 'yaml';
  if (language === 'toml') return 'toml';
  return null;
}

/** JSON, through `jsonc-parser` so the range is the offending token, not "line 1". */
async function jsonProblems(text: string): Promise<ParseProblem[]> {
  const { parse, printParseErrorCode } = await import('jsonc-parser');
  const errors: ParseError[] = [];
  // Strict JSON on purpose: a `tsconfig` is read by tools that reject comments,
  // and a lint that accepts them would bless a file the toolchain refuses.
  parse(text, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: true });
  // ONE diagnostic per position. The parser recovers and reports a second,
  // less specific error at the same offset (a trailing comma is both
  // `PropertyNameExpected` and `ValueExpected`), and two squiggles on one
  // character read as two problems. The first is the specific one.
  const seen = new Set<number>();
  const problems: ParseProblem[] = [];
  for (const error of errors) {
    if (seen.has(error.offset)) continue;
    seen.add(error.offset);
    problems.push({
      from: error.offset,
      // A zero-length range draws nothing in the editor, so the minimum is one
      // character — the one the parser pointed at.
      to: error.offset + Math.max(error.length, 1),
      message: printParseErrorCode(error.error),
      severity: 'error',
    });
  }
  return problems;
}

/** YAML, through the same `yaml` package the server already parses config with. */
async function yamlProblems(text: string): Promise<ParseProblem[]> {
  const { parseDocument } = await import('yaml');
  // `prettyErrors: false` because the editor shows the message in a tooltip,
  // where a multi-line excerpt with carets is unreadable.
  const doc = parseDocument(text, { prettyErrors: false });
  const problems: ParseProblem[] = doc.errors.map((error) => ({
    from: error.pos[0],
    to: Math.max(error.pos[1], error.pos[0] + 1),
    message: error.message,
    severity: 'error' as const,
  }));
  for (const warning of doc.warnings) {
    problems.push({
      from: warning.pos[0],
      to: Math.max(warning.pos[1], warning.pos[0] + 1),
      message: warning.message,
      severity: 'warning',
    });
  }
  return problems;
}

/** TOML, through `smol-toml` — its error carries a 1-based line and column. */
async function tomlProblems(text: string): Promise<ParseProblem[]> {
  const { parse, TomlError } = await import('smol-toml');
  try {
    parse(text);
    return [];
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    const from = lineStartOffset(text, error.line - 1) + Math.max(error.column - 1, 0);
    // The message's first line is the sentence; the rest is a code block with a
    // caret, which a tooltip cannot lay out.
    return [{ from, to: from + 1, message: error.message.split('\n')[0], severity: 'error' }];
  }
}

const PARSERS: Record<ParserKind, (text: string) => Promise<ParseProblem[]>> = {
  json: jsonProblems,
  yaml: yamlProblems,
  toml: tomlProblems,
};

/**
 * The problems in `text`, or an empty list when the parser module could not load.
 *
 * A failed import is reported as "no diagnostics" rather than thrown: the editor
 * must keep working on a format whose parser is missing, and the surface already
 * has an `exceptionSink` for anything that does throw.
 */
export async function parseProblems(kind: ParserKind, text: string): Promise<ParseProblem[]> {
  return PARSERS[kind](text);
}
