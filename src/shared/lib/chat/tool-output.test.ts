/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool output is rendered as markdown, with one override: an XML wrapper that
 * opens the output is transport, not content, so it is peeled before parsing.
 * What makes the parser hard is telling that wrapper apart from markup that IS
 * the content — a tag in the middle of prose, a mismatched pair, a second
 * element after the first, a tag inside a fenced or inline code sample — and
 * from content markdown would reflow (a log, a JSON body) once the wrapper is
 * gone.
 */

import { describe, expect, test } from 'bun:test';

import { outputMarkdown, readToolOutput } from '@/shared/lib/chat/tool-output';

describe('readToolOutput XML envelope', () => {
  test('peels a wrapper that opens the output and keeps the trailing line', () => {
    const output = readToolOutput(
      '<system-reminder reason="rule_violation" rule="ts-no-inline-cast-access">\n' +
        'MUST comply with the following instruction.\n' +
        '</system-reminder>\n' +
        'Successfully wrote 3604 bytes to src/a.ts',
    );

    expect(output.envelopes[0]?.tag).toBe('system-reminder');
    expect(output.envelopes[0]?.attributes).toEqual({
      reason: 'rule_violation',
      rule: 'ts-no-inline-cast-access',
    });
    expect(output.content).toBe(
      'MUST comply with the following instruction.\n\nSuccessfully wrote 3604 bytes to src/a.ts',
    );
  });

  test('reads single-quoted and valueless attributes', () => {
    expect(readToolOutput("<a rule='ts-x' flag>\nbody\n</a>").envelopes[0]?.attributes).toEqual({
      rule: 'ts-x',
      flag: '',
    });
  });

  test('dedents the wrapper body so markdown reads it as prose, not a code block', () => {
    const output = readToolOutput('<result>\n  # Judul\n  teks biasa\n</result>');

    expect(output.content).toBe('# Judul\nteks biasa');
    expect(output.format).toBe('markdown');
    expect(outputMarkdown(output.content, output.format)).toBe('# Judul\nteks biasa');
  });

  test('handles a `>` inside an attribute value and nested elements', () => {
    expect(readToolOutput('<a title="x > y">\n<b>1</b>\n</a>').content).toBe('<b>1</b>');
  });

  test('leaves markup that does not open the output alone', () => {
    const raw = 'Set <name> to the file, then run <cmd />';
    const output = readToolOutput(raw);

    expect(output.envelopes).toEqual([]);
    expect(output.content).toBe(raw);
  });

  test('leaves mismatched and self-closing roots alone', () => {
    expect(readToolOutput('<a>\n<b>x</a>').envelopes).toEqual([]);
    expect(readToolOutput('<hr />').envelopes).toEqual([]);
    expect(readToolOutput('<!-- note -->\nbody').envelopes).toEqual([]);
  });

  test('does not peel when a non-reminder sibling element follows', () => {
    expect(readToolOutput('<a>1</a><b>2</b>').envelopes).toEqual([]);
    expect(readToolOutput('<div><p>a</p></div><div>b</div>').envelopes).toEqual([]);
  });
});

/**
 * A reminder that documents a rule carries the rule's own TypeScript — and that
 * sample contains markup (`Promise<LoadedConfig>`, `<div>` in a fenced block).
 * Reading those as tags unbalanced the scan, so the wrapper was never
 * recognized and the whole reminder leaked into the timeline as raw markup.
 * Measured on this install: 99 of 352 reminder blocks carry such a sample.
 */
describe('readToolOutput envelope scan ignores code', () => {
  test('a fenced block hides the markup inside it', () => {
    const output = readToolOutput(
      '<system-reminder rule="ts-no-return-type">\n' +
        'Name the type at the module that owns the value.\n\n' +
        '```typescript\n' +
        'type Config = Awaited<ReturnType<typeof loadConfig>>;\n' +
        'export function loadConfig(path: string): Promise<LoadedConfig> { ... }\n' +
        '```\n' +
        '</system-reminder>',
    );

    expect(output.envelopes[0]?.attributes.rule).toBe('ts-no-return-type');
    expect(output.content).toContain('Promise<LoadedConfig>');
  });

  test('an inline code span hides the markup inside it', () => {
    const output = readToolOutput(
      '<system-reminder rule="ts-no-return-type">\n' +
        'Do not publish contracts through `ReturnType<typeof fn>`.\n' +
        '</system-reminder>',
    );

    expect(output.envelopes[0]?.tag).toBe('system-reminder');
    expect(output.content).toBe('Do not publish contracts through `ReturnType<typeof fn>`.');
  });

  test('a lone backtick pair does not swallow the wrapper end tag', () => {
    const output = readToolOutput(
      '<system-reminder>\nwrite `` to xd://propose\n</system-reminder>',
    );

    expect(output.envelopes[0]?.tag).toBe('system-reminder');
    expect(output.content).toBe('write `` to xd://propose');
  });
});

/**
 * omp emits ONE REMINDER PER MATCHED RULE, so a single tool result routinely
 * opens with two of them. Refusing the run as "a sibling element" is what left
 * 86 of this install's 353 reminder blocks rendered as raw markup.
 */
describe('readToolOutput reminder runs', () => {
  test('peels every reminder of a run, keeping each one\u2019s attributes', () => {
    const output = readToolOutput(
      '<system-reminder rule="ts-no-tiny-functions">\nInline it.\n</system-reminder>\n\n' +
        '<system-reminder rule="ts-set-map">\nUse a Record.\n</system-reminder>',
    );

    expect(output.envelopes.map((envelope) => envelope.attributes.rule)).toEqual([
      'ts-no-tiny-functions',
      'ts-set-map',
    ]);
    expect(output.content).toBe('Inline it.\n\nUse a Record.');
  });

  test('a run keeps free text that follows the last wrapper', () => {
    const output = readToolOutput(
      '<system-reminder>\nfirst\n</system-reminder>\n\n' +
        '<system-reminder>\nsecond\n</system-reminder>\n\n' +
        'Successfully wrote 3604 bytes to src/a.ts',
    );

    expect(output.envelopes).toHaveLength(2);
    expect(output.content).toBe('first\n\nsecond\n\nSuccessfully wrote 3604 bytes to src/a.ts');
  });
});

/**
 * omp rewrites a command and reports it AFTER the output, so there is no
 * leading wrapper to peel — `<system-warning>` on its own line at the end is
 * the shape, and rendered as markdown it showed as escaped markup.
 */
describe('readToolOutput trailing notice', () => {
  test('peels a notice appended after the output', () => {
    const output = readToolOutput(
      'start-command-template.md\ntelegram.md\nthemes.md\n\n' +
        '<system-warning>Stripped redundant `| head -50` — bash output is already truncated.</system-warning>',
    );

    expect(output.envelopes.map((envelope) => envelope.tag)).toEqual(['system-warning']);
    expect(output.content).toBe(
      'start-command-template.md\ntelegram.md\nthemes.md\n\n' +
        'Stripped redundant `| head -50` — bash output is already truncated.',
    );
  });

  test('a notice quoted inside the output stays content', () => {
    const quoted = "f.ts:1:  '<system-warning>x</system-warning>'";
    const output = readToolOutput(quoted);

    expect(output.envelopes).toEqual([]);
    expect(output.content).toBe(quoted);
  });

  test('a trailing notice must close the output', () => {
    // Output first, notice on its own line, then more output: the pair does not
    // end the text, so it is content rather than a notice omp appended.
    const raw = 'line one\n\n<system-warning>x</system-warning>\nmore output';
    const output = readToolOutput(raw);

    expect(output.envelopes).toEqual([]);
    expect(output.content).toBe(raw);
  });
});

describe('outputMarkdown', () => {
  test('fences JSON so the parser cannot reflow it', () => {
    const output = readToolOutput('{\n  "a": 1\n}');

    expect(output.format).toBe('json');
    expect(outputMarkdown(output.content, output.format)).toBe('```json\n{\n  "a": 1\n}\n```');
  });

  test('fences a plain log without a language', () => {
    expect(outputMarkdown('error: boom\n  at foo', 'text')).toBe('```\nerror: boom\n  at foo\n```');
  });

  test('outgrows a fence already present in the content', () => {
    expect(outputMarkdown('a ``` b', 'json')).toBe('````json\na ``` b\n````');
  });
});
