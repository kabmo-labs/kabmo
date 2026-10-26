/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The indent table, and the GATE that keeps it honest.
 *
 * The gate is the load-bearing half. Measured: an `indentService` that returns a
 * NUMBER overrides a stream mode's own answer (JavaScript's 11 became 0), while
 * returning `undefined` falls through. So every language whose installed mode
 * answers must be ABSENT from `INDENT_RULES`, and the first test below
 * re-derives that set from the installed `@codemirror/legacy-modes` — a mode that
 * later grows an `indent()` fails here instead of silently degrading 34 working
 * languages.
 */

import { describe, expect, test } from 'bun:test';

import { StreamLanguage, indentUnit, getIndentation } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

import {
  INDENT_RULES,
  indentAfter,
  indentForCloser,
  indentOnInputPattern,
  leadingWidth,
} from '@/shared/lib/code/editor/indent-rules';
import { STREAM_MODE_LOADERS, STREAM_MODE_EXPORTS, TEXTUAL_ONLY_LANGS } from '@/shared/lib/code/editor/stream-modes';

/** One "a block just opened" snippet per language, as the survey used. */
const OPENER: Record<string, string> = {
  typescript: 'if (x) {', javascript: 'if (x) {', tsx: 'const a = (', jsx: 'const a = (',
  c: 'void f() {', cpp: 'void f() {', csharp: 'void F() {', java: 'void f() {',
  go: 'func f() {', rust: 'fn f() {', kotlin: 'fun f() {', swift: 'func f() {',
  dart: 'void f() {', scala: 'def f = {', groovy: 'def f() {', 'objective-c': 'void f() {',
  css: 'a {', scss: 'a {', less: 'a {', stylus: 'a', sass: 'a', json: '{', json5: '{',
  xml: '<a>', julia: 'function f()', lua: 'if x then', r: 'if (TRUE) {',
  clojure: '(defn f [x]', racket: '(define (f x)', scheme: '(define (f x)',
  elixir: 'defmodule M do', erlang: 'f() ->', python: 'def f():', ruby: 'def f',
  perl: 'if ($x) {', powershell: 'if ($x) {', yaml: 'a:', toml: 'a = {', hcl: 'a {',
  ini: '[a', protobuf: 'message M {', dockerfile: 'RUN a \\', bash: 'if true; then',
  haskell: 'f x =', ocaml: 'let f x =', makefile: 'all:', properties: 'a=1', sql: 'SELECT',
};

/** Languages whose installed mode answers `getIndentation` for its opener. */
async function languagesTheModeAnswers(): Promise<Set<string>> {
  const answering = new Set<string>();
  for (const [language, opener] of Object.entries(OPENER)) {
    const loader = STREAM_MODE_LOADERS[language];
    if (!loader) continue;
    const module = (await loader()) as Record<string, unknown>;
    const mode = module[STREAM_MODE_EXPORTS[language]];
    const state = EditorState.create({
      doc: opener,
      extensions: [indentUnit.of('  '), StreamLanguage.define(mode as never)],
    });
    if (getIndentation(state, opener.length) !== null) answering.add(language);
  }
  return answering;
}

describe('INDENT_RULES is exactly the set of languages whose parser cannot answer', () => {
  test('a language whose mode answers must NOT have an `opens` rule, or it overrides the mode', async () => {
    const answering = await languagesTheModeAnswers();
    // Measured on 6.5.5: 34 ids answer. Asserting the count is what makes an
    // upstream change to one mode show up as a failure rather than a silent
    // regression in a language nobody re-checked.
    expect(answering.size).toBe(34);

    const overridden = Object.keys(INDENT_RULES).filter(
      (language) => answering.has(language) && INDENT_RULES[language]?.opens !== undefined,
    );
    expect(overridden).toEqual([]);
  });

  test('every mode-less language has an `opens` rule, so Enter is answered', async () => {
    const answering = await languagesTheModeAnswers();
    const needsOpens = [
      ...Object.keys(STREAM_MODE_LOADERS).filter((language) => !answering.has(language)),
      ...TEXTUAL_ONLY_LANGS,
    ];
    const missing = needsOpens.filter((language) => INDENT_RULES[language]?.opens === undefined);
    expect(missing).toEqual([]);
  });

  test('a closer rule may be added to a language whose mode answers Enter', () => {
    // `go`'s own regexp demands exactly one space, so `  }` never dedents there.
    // These entries add the closer half ONLY — an `opens` would shadow the mode.
    const answeringWithCloser = ['go', 'tsx', 'jsx'];
    for (const language of answeringWithCloser) {
      expect(INDENT_RULES[language]?.closes).toBeDefined();
      expect(INDENT_RULES[language]?.opens).toBeUndefined();
    }
  });
});

describe('indentAfter — what Enter asks of the line above', () => {
  test('a YAML key opens a block', () => {
    expect(indentAfter('yaml', 'a:')).toBe(2);
    expect(indentAfter('yaml', 'a:\n  b: 1'.split('\n')[1])).toBe(2);
  });

  test('a YAML list item does NOT open one — its continuation is at its own column', () => {
    expect(indentAfter('yaml', '- item')).toBe(0);
    expect(indentAfter('yaml', '  - item')).toBe(2);
  });

  test('a brace opens a block in the brace families', () => {
    expect(indentAfter('toml', 'a = {')).toBe(2);
    expect(indentAfter('hcl', 'resource "a" "b" {')).toBe(2);
    expect(indentAfter('graphql', 'query Q {')).toBe(2);
    expect(indentAfter('php', 'function f() {')).toBe(2);
  });

  test('a keyword opens a block in bash, and a trailing backslash continues in Dockerfile', () => {
    expect(indentAfter('bash', 'if true; then')).toBe(2);
    expect(indentAfter('bash', 'for x in a; do')).toBe(2);
    expect(indentAfter('bash', 'echo hi')).toBe(0);
    expect(indentAfter('dockerfile', 'RUN apt-get install \\')).toBe(2);
    expect(indentAfter('dockerfile', 'FROM node')).toBe(0);
  });

  test('an expression body opens in the layout languages', () => {
    expect(indentAfter('haskell', 'f x =')).toBe(2);
    expect(indentAfter('ocaml', 'let f x =')).toBe(2);
  });

  test('an unclosed HTML tag opens, a closing tag does not', () => {
    expect(indentAfter('html', '<div>')).toBe(2);
    expect(indentAfter('html', '</div>')).toBe(0);
    expect(indentAfter('html', '<br/>')).toBe(0);
  });

  test('the flat languages never move the indent', () => {
    for (const language of ['sql', 'makefile', 'properties', 'markdown', 'diff', 'text']) {
      expect(indentAfter(language, 'anything {')).toBe(0);
      expect(indentAfter(language, '  already indented')).toBe(2);
    }
  });

  test('a language with no rule answers null, so the parser keeps its own answer', () => {
    expect(indentAfter('typescript', 'if (x) {')).toBeNull();
    expect(indentAfter('python', 'def f():')).toBeNull();
  });

  test('the unit is the caller’s, so a tab-size setting propagates', () => {
    expect(indentAfter('yaml', 'a:', 4)).toBe(4);
    expect(indentAfter('yaml', '    a:', 4)).toBe(8);
  });
});

describe('indentForCloser — what indentOnInput asks of the line that now starts with one', () => {
  test('a closer dedents one level in the bracket families', () => {
    expect(indentForCloser('toml', '  }')).toBe(0);
    expect(indentForCloser('hcl', '    }')).toBe(2);
    expect(indentForCloser('graphql', '  ]')).toBe(0);
  });

  test('a closer in a flat language is content and is left alone', () => {
    expect(indentForCloser('markdown', '  ]')).toBeNull();
    expect(indentForCloser('yaml', '  }')).toBeNull();
    expect(indentForCloser('sql', '  )')).toBeNull();
  });

  test('a line that is not a closer is not touched', () => {
    expect(indentForCloser('toml', '  a = 1')).toBeNull();
    // Anchored at both ends: `}x` is content, not a dedent.
    expect(indentForCloser('toml', '  }x')).toBeNull();
  });

  test('never goes below column zero', () => {
    expect(indentForCloser('toml', '}')).toBe(0);
  });
});

describe('indentOnInputPattern', () => {
  test('a bracket family gets its own closer pattern', () => {
    const pattern = indentOnInputPattern('toml');
    expect(pattern).not.toBeNull();
    expect(pattern!.test('}')).toBe(true);
    expect(pattern!.test('  }')).toBe(true);
    expect(pattern!.test('\t}')).toBe(true);
    expect(pattern!.test('  ]')).toBe(true);
    expect(pattern!.test('}x')).toBe(false);
    expect(pattern!.test('a')).toBe(false);
  });

  test('bash accepts its own keywords as closers', () => {
    const pattern = indentOnInputPattern('bash');
    expect(pattern!.test('fi')).toBe(true);
    expect(pattern!.test('done')).toBe(true);
    expect(pattern!.test('esac')).toBe(true);
    expect(pattern!.test('echo')).toBe(false);
  });

  test('a language with no closers gets NO pattern — the generic bracket rule is wrong there', () => {
    // Measured before this gate existed: the generic pattern turned `a:\n  }`
    // into `a:\n}`, moving YAML content the user did not ask to move.
    for (const language of ['yaml', 'markdown', 'sql', 'makefile', 'properties', 'diff', 'text', 'haskell', 'ocaml', 'dockerfile']) {
      expect(indentOnInputPattern(language)).toBeNull();
    }
  });

  test('a language with no rule at all gets no pattern', () => {
    expect(indentOnInputPattern('typescript')).toBeNull();
    expect(indentOnInputPattern('python')).toBeNull();
  });
});

describe('leadingWidth', () => {
  test('counts the leading whitespace only', () => {
    expect(leadingWidth('abc')).toBe(0);
    expect(leadingWidth('  abc')).toBe(2);
    expect(leadingWidth('\tabc')).toBe(1);
    expect(leadingWidth('   ')).toBe(3);
  });
});
