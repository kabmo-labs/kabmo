/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The lint extension: which languages get it, and what a document reports.
 *
 * The wiring is the part that fails silently. `linter()` alone registers a
 * source nobody can see; `lintGutter()` alone draws a gutter with no markers.
 * And a language with no parser must add NEITHER — an empty linter would still
 * put a gutter beside every file in the repository.
 *
 * The diagnostics are asserted through `lintDiagnostics`, not through a mounted
 * view: `linter()` schedules its own run on a timer, and a test that waited for
 * it would be guessing at a duration rather than asserting a behaviour.
 */

import { describe, expect, test } from 'bun:test';

import { LINT_MAX_CHARS, lintDiagnostics, lintExtensions } from '@/client/components/common/code-surface/lint';

describe('lintExtensions', () => {
  test('the three config formats get a linter and a gutter', () => {
    for (const language of ['json', 'yaml', 'toml']) {
      expect(lintExtensions(language)).toHaveLength(2);
    }
  });

  test('every other language gets nothing at all', () => {
    // Not "an empty linter": a gutter beside every TypeScript file would be a
    // permanent 4px column reporting nothing.
    for (const language of ['typescript', 'json5', 'markdown', 'python', '']) {
      expect(lintExtensions(language)).toEqual([]);
    }
  });
});

describe('lintDiagnostics', () => {
  test('a JSON trailing comma is one diagnostic, at the closing brace', async () => {
    const text = '{\n  "a": 1,\n}\n';
    const diagnostics = await lintDiagnostics('json', text);
    expect(diagnostics).toHaveLength(1);
    expect(text.slice(diagnostics[0].from, diagnostics[0].to)).toBe('}');
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].message).toBe('PropertyNameExpected');
  });

  test('valid JSON reports none', async () => {
    expect(await lintDiagnostics('json', '{"a": 1}')).toEqual([]);
  });

  test('a YAML document with an unclosed sequence reports one', async () => {
    const diagnostics = await lintDiagnostics('yaml', 'a: [1, 2\n');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe('error');
  });

  test('a TOML document with a bad assignment reports one', async () => {
    const diagnostics = await lintDiagnostics('toml', '[tool]\nname = \n');
    expect(diagnostics).toHaveLength(1);
    // A tooltip cannot lay out the code block the parser appends.
    expect(diagnostics[0].message).not.toContain('\n');
  });

  test('a language with no parser reports nothing, whatever the text', async () => {
    expect(await lintDiagnostics('typescript', 'const = ;')).toEqual([]);
  });

  test('a document past the ceiling is not parsed', async () => {
    // A generated 2 MB manifest must not be re-parsed on every idle moment.
    expect(LINT_MAX_CHARS).toBe(2 * 1024 * 1024);
    const huge = `{"a": "${'x'.repeat(LINT_MAX_CHARS)}"`;
    expect(await lintDiagnostics('json', huge)).toEqual([]);
  });

  test('a conflicted config file reports no parse errors', async () => {
    // Every error below a marker is a consequence of the merge, and the conflict
    // band plus the status strip already say so. Measured before this rule: four
    // gutter markers on a one-conflict JSON file.
    const conflicted = ['{', '<<<<<<< HEAD', '  "a": 1,', '=======', '  "a": 2,', '>>>>>>> x', '}'].join('\n');
    expect(await lintDiagnostics('json', conflicted)).toEqual([]);
  });

  test('a document that merely mentions the marker is still linted', async () => {
    const text = '{"note": "<<<<<<< HEAD"}';
    expect(await lintDiagnostics('json', text)).toEqual([]);
    // And a real error in such a document is still reported.
    const broken = '{"note": "<<<<<<< HEAD",}';
    expect((await lintDiagnostics('json', broken)).length).toBeGreaterThan(0);
  });

  test('every range is inside the document and non-empty', async () => {
    const text = '{\n  "a": 1,\n}\n';
    for (const diagnostic of await lintDiagnostics('json', text)) {
      expect(diagnostic.from).toBeGreaterThanOrEqual(0);
      expect(diagnostic.to).toBeGreaterThan(diagnostic.from);
      expect(diagnostic.to).toBeLessThanOrEqual(text.length);
    }
  });
});
