/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Lint parsers: the range each format's error actually points at.
 *
 * The value of this feature is the POSITION — a squiggle on line 1 for a
 * trailing comma on line 40 is the "your JSON is broken somewhere" message the
 * editor already gave by doing nothing. Each format reports differently
 * (jsonc-parser speaks offsets, YAML speaks `[start, end]`, TOML speaks a 1-based
 * line and column), so the conversion is what these cases pin.
 *
 * The parsers load through `import()`, so every case is async.
 */

import { describe, expect, test } from 'bun:test';

import { parseProblems, parserKindFor } from '@/client/components/common/code-surface/lint-parsers';

describe('parserKindFor', () => {
  test('the three config formats are linted', () => {
    expect(parserKindFor('json')).toBe('json');
    expect(parserKindFor('yaml')).toBe('yaml');
    expect(parserKindFor('toml')).toBe('toml');
  });

  test('everything else is not', () => {
    // `json5` is deliberately absent: it accepts what strict JSON rejects, so a
    // diagnostic there would accuse a valid file.
    for (const language of ['typescript', 'json5', 'markdown', 'yamlx', '']) {
      expect(parserKindFor(language)).toBeNull();
    }
  });
});

describe('json', () => {
  test('valid JSON has no problems', async () => {
    expect(await parseProblems('json', '{"a": 1, "b": [true, null]}')).toEqual([]);
  });

  test('a trailing comma points at the closing brace, once', async () => {
    const text = '{\n  "a": 1,\n}\n';
    const problems = await parseProblems('json', text);
    // The parser recovers and reports two errors at the same offset; one
    // squiggle per position is the rule, and this pins it.
    expect(problems).toHaveLength(1);
    expect(text.slice(problems[0].from, problems[0].to)).toBe('}');
    expect(problems[0].severity).toBe('error');
  });

  test('a comment is refused, because strict JSON refuses it', async () => {
    const problems = await parseProblems('json', '{\n  // note\n  "a": 1\n}');
    expect(problems).toHaveLength(1);
    expect(problems[0].message.length).toBeGreaterThan(0);
  });

  test('an empty document is not an error', async () => {
    // A file the user just created is empty; accusing it before they type is
    // noise, not a diagnostic.
    expect(await parseProblems('json', '')).toEqual([]);
  });

  test('the range is at least one character', async () => {
    const problems = await parseProblems('json', '{"a": }');
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) expect(problem.to).toBeGreaterThan(problem.from);
  });
});

describe('yaml', () => {
  test('valid YAML has no problems', async () => {
    expect(await parseProblems('yaml', 'model: gpt\nroles:\n  chat: gpt\n')).toEqual([]);
  });

  test('an unclosed flow sequence points inside the document', async () => {
    const text = 'a: 1\nb: [1, 2\nc: 3\n';
    const problems = await parseProblems('yaml', text);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].severity).toBe('error');
    expect(problems[0].from).toBeGreaterThanOrEqual(0);
    expect(problems[0].to).toBeLessThanOrEqual(text.length);
  });
});

describe('toml', () => {
  test('valid TOML has no problems', async () => {
    expect(await parseProblems('toml', '[tool]\nname = "x"\n')).toEqual([]);
  });

  test('the line and column become a document offset', async () => {
    // Line 2, after `[tool]\n`, and the bad token is on that line.
    const text = '[tool]\nname = \nversion = "1"\n';
    const problems = await parseProblems('toml', text);
    expect(problems).toHaveLength(1);
    expect(problems[0].from).toBeGreaterThan('[tool]\n'.length - 1);
    // The message is the first line only: a tooltip cannot lay out the code
    // block the parser appends.
    expect(problems[0].message).not.toContain('\n');
  });

  test('an error on the first line lands on the first line', async () => {
    const text = '= broken\n';
    const problems = await parseProblems('toml', text);
    expect(problems).toHaveLength(1);
    expect(problems[0].from).toBe(0);
  });
});
