/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * XML section wrappers in omp's `xd://` docs (`<instruction>`, `<examples>`,
 * `<critical>`) became headings before the markdown parse. Without that, the
 * prose path escaped the tags — the reader saw `<instruction>` as a literal
 * line and every section ran together as one block.
 *
 * The gates are what the tests pin: a paired, whole-line wrapper is rewritten,
 * and nothing else is (a code fence showing the tags as an example, an
 * attribute-carrying wrapper, an unpaired tag, a tag inside a sentence).
 */

import { describe, expect, test } from 'bun:test';
import { xmlSectionsToHeadings } from '@/shared/lib/markdown/xml-sections';

describe('xmlSectionsToHeadings', () => {
  test('paired wrappers become headings and their closing lines disappear', () => {
    const source = [
      'Intro line.',
      '',
      '<instruction>',
      '- Static content? Use `read`.',
      '</instruction>',
      '',
      '<critical>',
      '- MUST open a tab before direct use.',
      '</critical>',
    ].join('\n');

    expect(xmlSectionsToHeadings(source)).toBe([
      'Intro line.',
      '',
      '## Instruction',
      '- Static content? Use `read`.',
      '',
      '',
      '## Critical',
      '- MUST open a tab before direct use.',
      '',
    ].join('\n'));
  });

  test('nesting steps the heading level down, capped at h6', () => {
    const source = [
      '<outer>',
      '<inner>',
      'text',
      '</inner>',
      '</outer>',
      '<a>',
      '<b>',
      '<c>',
      '<d>',
      '<e>',
      'deep',
      '</e>',
      '</d>',
      '</c>',
      '</b>',
      '</a>',
    ].join('\n');

    expect(xmlSectionsToHeadings(source)).toBe([
      '## Outer',
      '### Inner',
      'text',
      '',
      '',
      '## A',
      '### B',
      '#### C',
      '##### D',
      '###### E',
      'deep',
      '',
      '',
      '',
      '',
      '',
    ].join('\n'));
  });

  test('a crossed pair leaves the unmatched lines literal', () => {
    // Valid = open + matching close, properly nested. `<a>` never gets its own
    // close where the stack expects it, so only the well-formed `<b>` pair is
    // a section.
    const source = ['<a>', 'text', '<b>', 'inner', '</a>', '</b>'].join('\n');

    expect(xmlSectionsToHeadings(source)).toBe(
      ['<a>', 'text', '## B', 'inner', '</a>', ''].join('\n'),
    );
  });

  test('a fenced block that shows the wrappers keeps them verbatim', () => {
    const source = [
      '<instruction>',
      'Outer section.',
      '```xml',
      '<instruction>',
      'literal',
      '</instruction>',
      '```',
      '</instruction>',
    ].join('\n');

    expect(xmlSectionsToHeadings(source)).toBe([
      '## Instruction',
      'Outer section.',
      '```xml',
      '<instruction>',
      'literal',
      '</instruction>',
      '```',
      '',
    ].join('\n'));
  });

  test('an unpaired or inline tag is left exactly as written', () => {
    const source = [
      '<summary>',
      'no closing partner',
      'use <slug> here',
      '<system-reminder reason="a rule fired">',
      'wrapped with attributes',
      '</system-reminder>',
      'closing without an opener: </notes>',
    ].join('\n');

    expect(xmlSectionsToHeadings(source)).toBe(source);
  });

  test('a source with no tags is returned untouched', () => {
    const source = '# Title\n\n- a < b';
    expect(xmlSectionsToHeadings(source)).toBe(source);
  });
});