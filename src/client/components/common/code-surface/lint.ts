/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's lint: a parser's verdict, painted where the problem is.
 *
 * ## The parsers are the only honest source here
 *
 * There is no language server behind this, and there will not be one: the
 * editor is a file viewer, not an IDE. What a parser can answer is exactly what
 * a reader of a config file needs — "this document is not valid JSON/YAML/TOML,
 * and here is the byte" — and nothing more. A linter that also offered style
 * opinions would be inventing rules the repository does not have.
 *
 * ## Which formats, and why not more
 *
 * JSON, YAML and TOML, because those are the three formats this app edits as
 * CONFIG (omp settings are YAML, `bunfig`/`pyproject` are TOML, every manifest
 * is JSON) and all three have a parser that is already a dependency or is
 * measured small. `json5` is deliberately excluded: it accepts what strict JSON
 * rejects, so a diagnostic there would be a false accusation.
 *
 * ## The parsers arrive lazily
 *
 * See `lint-parsers.ts`. This module is in the main bundle and holds no parser.
 */

import type { Extension } from '@codemirror/state';
import { linter, lintGutter, type Diagnostic, type LintSource } from '@codemirror/lint';

import { parseProblems, parserKindFor } from '@/client/components/common/code-surface/lint-parsers';
import { hasConflictMarker } from '@/client/components/common/code-surface/conflict-markers';

/**
 * Documents above this are not linted.
 *
 * A 2 MB manifest is a generated file, and re-parsing it on every idle moment
 * costs more than the diagnostics are worth. The number is the same ceiling the
 * highlighter refuses to tokenize past, for the same reason.
 */
export const LINT_MAX_CHARS = 2 * 1024 * 1024;

/** How long the editor waits after the last keystroke. */
const LINT_DELAY_MS = 600;

/**
 * A parser's problems as CodeMirror diagnostics, clamped to the document.
 *
 * Exported because it is the unit that can be tested without a timer: the
 * mounted path is `linter()`'s own async scheduling, and a test that waited for
 * it would be guessing at a duration rather than asserting a behaviour.
 */
export async function lintDiagnostics(language: string, text: string): Promise<Diagnostic[]> {
  const kind = parserKindFor(language);
  if (!kind || text.length > LINT_MAX_CHARS) return [];
  // A file mid-merge is not a broken JSON/YAML/TOML document — it is two
  // documents with markers between them, and every parse error below the first
  // marker is a CONSEQUENCE of that. Measured on a one-conflict JSON file: four
  // gutter markers and four squiggles, none of which told the reader anything
  // the conflict band and the status strip's `⚠ 1 conflict` do not already say.
  // The conflict is the problem; the parser is not the right tool to report it.
  if (hasConflictMarker(text)) return [];
  const problems = await parseProblems(kind, text);
  return problems.map((problem) => ({
    from: Math.max(0, Math.min(problem.from, text.length)),
    to: Math.max(0, Math.min(problem.to, text.length)),
    severity: problem.severity,
    message: problem.message,
  }));
}

/**
 * The lint extension for one language, or an empty list for every other.
 *
 * `lintGutter` is part of the same value: a diagnostic with no gutter marker is
 * a squiggle the reader has to find by scrolling, and the two extensions share
 * the diagnostics field they read.
 */
export function lintExtensions(language: string): Extension[] {
  if (!parserKindFor(language)) return [];
  const source: LintSource = (view) => lintDiagnostics(language, view.state.doc.toString());
  return [linter(source, { delay: LINT_DELAY_MS }), lintGutter()];
}
