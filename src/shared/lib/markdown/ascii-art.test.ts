/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A hand-drawn box closes its rows at the wrong column, and the console makes
 * the frame legible without touching the text inside it.
 *
 * The failure this pins: an agent asked to render a panel as ASCII drew a
 * 101-column frame, then closed two description rows at columns 100 and 102 and
 * dropped the outer border on several boxed rows. The frame looked broken; the
 * code block was rendering the bytes faithfully. `healAsciiBoxes` moves only a
 * misplaced CLOSING border (spaces only, never content) and appends a missing
 * outer one — an inner border is never moved.
 *
 * The refusals matter as much as the repair: a `ts` fence, a README preview, a
 * shell pipe, a tree, or art with a wide glyph must come back untouched.
 */

import { describe, expect, test } from 'bun:test';
import { healAsciiBoxes } from '@/shared/lib/markdown/ascii-art';

const RULE = '+--------------------+'; // 22 columns

/** A row padded to `width` columns, closing with `|` at the last one. */
const row = (text: string, width = RULE.length) => '|' + text.padEnd(width - 2) + '|';

describe('healAsciiBoxes straightens the frame', () => {
  test('a row closed one column early is padded to the frame', () => {
    const early = '| early' + ' '.repeat(13) + '|'; // 21 columns, border at 20
    const input = [RULE, row(' ok'), early, RULE].join('\n');
    const out = healAsciiBoxes(input);
    const lines = out.split('\n');
    expect(lines[2].length).toBe(RULE.length);
    expect(lines[2].endsWith('|')).toBe(true);
    expect(lines[2]).toBe('| early' + ' '.repeat(14) + '|');
  });

  test('a row closed one column late drops only the trailing spaces', () => {
    const late = '| late' + ' '.repeat(15) + '|'; // 22 columns, border at 21
    const input = [RULE, row(' ok'), late, RULE].join('\n');
    const out = healAsciiBoxes(input);
    expect(out.split('\n')).toContain(row(' late'));
  });

  test('a row with no closing border gets one appended', () => {
    const input = [RULE, row(' ok'), '| open', RULE].join('\n');
    const out = healAsciiBoxes(input);
    expect(out.split('\n')).toContain(row(' open'));
  });

  test('an inner border stays where it is; only the outer one is added', () => {
    const nestedRule = '+------+';
    const input = [
      RULE,
      row(' outer'),
      '| ' + nestedRule.padEnd(RULE.length - 3) + '|',
      '| | b  |' + ' '.repeat(13) + '|', // inner + outer, both closed
      '| | c  |', // inner closed, outer missing
      RULE,
    ].join('\n');
    const out = healAsciiBoxes(input).split('\n');
    expect(out[3]).toBe('| | b  |' + ' '.repeat(13) + '|');
    expect(out[4]).toBe('| | c  |' + ' '.repeat(13) + '|');
  });

  test('a correct box is returned unchanged', () => {
    const input = [RULE, row(' one'), row(' two'), RULE].join('\n');
    expect(healAsciiBoxes(input)).toBe(input);
  });

  test('CRLF line endings survive the pass', () => {
    const early = '| early' + ' '.repeat(13) + '|';
    const input = [RULE, row(' ok'), early, RULE].join('\r\n');
    const out = healAsciiBoxes(input);
    expect(out.split('\r\n').every((line) => !line.endsWith('\r'))).toBe(true);
    expect(out).toContain('| early' + ' '.repeat(14) + '|\r\n');
  });
});

describe('healAsciiBoxes refuses what it cannot prove', () => {
  test('a text block that is not a frame is untouched', () => {
    const input = ['| grep foo', '| sort', 'plain prose'].join('\n');
    expect(healAsciiBoxes(input)).toBe(input);
  });

  test('a pipe table with no horizontal rule is untouched', () => {
    const input = ['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n');
    expect(healAsciiBoxes(input)).toBe(input);
  });

  test('art that does not open on a rule is untouched', () => {
    const input = ['| early' + ' '.repeat(13) + '|', RULE, row(' ok'), RULE].join('\n');
    expect(healAsciiBoxes(input)).toBe(input);
  });

  test('a bare dash rule is a separator, not a frame', () => {
    const dashed = '--------------------';
    const input = [dashed, '| early' + ' '.repeat(13) + '|', dashed].join('\n');
    expect(healAsciiBoxes(input)).toBe(input);
  });

  test('a single rule is not a frame', () => {
    const input = [RULE, '| early' + ' '.repeat(13) + '|'].join('\n');
    expect(healAsciiBoxes(input)).toBe(input);
  });

  test('a tab or a wide glyph aborts the pass', () => {
    const early = '| early' + ' '.repeat(13) + '|';
    expect(healAsciiBoxes([RULE, '| a\tb |', early, RULE].join('\n'))).toContain(early);
    expect(healAsciiBoxes([RULE, '| 漢字 |', early, RULE].join('\n'))).toContain(early);
  });

  test('a row that overflows with real content is not truncated', () => {
    const overflow = '| ' + 'x'.repeat(40);
    const input = [RULE, row(' ok'), overflow, RULE].join('\n');
    expect(healAsciiBoxes(input)).toContain(overflow);
  });

  test('art tailed by prose is not treated as a frame', () => {
    const input = [RULE, row(' ok'), RULE, 'that was the panel'].join('\n');
    expect(healAsciiBoxes(input)).toBe(input);
  });
});

describe('the markdown surface heals only agent-output text fences', () => {
  const ragged = '| early' + ' '.repeat(13) + '|';
  const healed = '| early' + ' '.repeat(14) + '|';
  const body = [RULE, row(' ok'), ragged, RULE].join('\n');
  const fence = (lang: string) => '```' + lang + '\n' + body + '\n```';

  test('a text fence renders and copies the straightened block', async () => {
    const { renderMarkdown } = await import('@/shared/lib/markdown/marked');
    const html = renderMarkdown(fence('text'));
    expect(html).toContain(healed);
    expect(html).not.toContain(ragged);
    // The copy button carries the SAME spelling: copying what was read, not a
    // second, ragged version of it.
    const copy = html.match(/data-copy="([^"]*)"/)?.[1] ?? '';
    expect(copy).toContain(healed);
    expect(copy).not.toContain(ragged);
  });

  test('a typed fence is code, not a picture', async () => {
    const { renderMarkdown } = await import('@/shared/lib/markdown/marked');
    expect(renderMarkdown(fence('ts'))).toContain(ragged);
  });

  test('a document preview renders the bytes the author wrote', async () => {
    const { renderMarkdown } = await import('@/shared/lib/markdown/marked');
    expect(renderMarkdown(fence('text'), { allowHtml: true })).toContain(ragged);
  });
});
