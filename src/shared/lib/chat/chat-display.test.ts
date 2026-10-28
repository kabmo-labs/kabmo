/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Small presentational helpers on the chat timeline.
 *
 * `formatDuration` boundaries are the point: a run under a second must render
 * nothing rather than "0s", and each unit switch (seconds → minutes → hours)
 * rounds DOWN so a 59.9s run never claims a minute. `responseRunDurationMs`
 * must return null — not a wrong number — when the end is unmeasurable or the
 * computed span is non-positive, because a bogus "0s"/negative footer is worse
 * than no footer.
 *
 * `parseEditOutput` turns omp's excerpt format into code rows plus prose. The
 * risky cases are a bracketed error that must NOT open a group, a header whose
 * rows never follow, elision markers that must be dropped rather than rendered
 * as code, and a result with no group at all that must survive as notes.
 *
 * The remaining helpers (`capitalizeFirstLetter`, `isSkippedTool`,
 * `normalizeNoticeText`, `detectOutputFormat`) are pinned on their boundary
 * inputs — accented letters, the skipped/aborted/synthetic trio, ANSI + notice
 * scaffolding, and the markdown-before-HTML/JSON ordering.
 */

import { describe, expect, test } from 'bun:test';

import { formatDuration, responseRunDurationMs } from '@/shared/lib/chat/duration';
import { parseEditOutput } from '@/shared/lib/chat/excerpt';
import { capitalizeFirstLetter } from '@/shared/lib/chat/capitalize';
import { isSkippedTool } from '@/shared/lib/chat/tool-status';
import { normalizeNoticeText } from '@/shared/lib/chat/notice-text';
import { detectOutputFormat } from '@/shared/lib/chat/detect-format';
import type { ToolCallData } from '@/shared/types';

describe('formatDuration', () => {
  test('renders nothing below a second or for invalid input', () => {
    expect(formatDuration(0)).toBeUndefined();
    expect(formatDuration(999)).toBeUndefined();
    expect(formatDuration(-1)).toBeUndefined();
    expect(formatDuration(Number.NaN)).toBeUndefined();
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  test('exactly one second is the first measurable duration', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  test('seconds floor, never rounding up into the next unit', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(59_999)).toBe('59s');
  });

  test('a minute switches to the m/s form', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(123_000)).toBe('2m 3s');
  });

  test('an hour switches to the h/m form and drops seconds', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m');
    expect(formatDuration(3_840_000)).toBe('1h 4m');
    expect(formatDuration(7_380_000)).toBe('2h 3m');
  });
});

describe('responseRunDurationMs', () => {
  test('measures from the preceding user message to the last AI message', () => {
    const messages = [
      { role: 'user', startedAt: 1000 },
      { role: 'assistant', startedAt: 1500 },
      { role: 'assistant', completedAt: 4500 },
    ];
    expect(responseRunDurationMs(messages, 2)).toBe(3500);
  });

  test('prefers startedAt/completedAt over string dates', () => {
    const messages = [
      { role: 'user', date: '2000-01-01T00:00:00.000Z', startedAt: 1000 },
      { role: 'assistant', date: '2030-01-01T00:00:00.000Z', completedAt: 2500 },
    ];
    expect(responseRunDurationMs(messages, 1)).toBe(1500);
  });

  test('falls back to the earliest timestamped AI fragment when there is no user turn', () => {
    const messages = [{ startedAt: 1000 }, { startedAt: 1500 }, { startedAt: 4000 }];
    expect(responseRunDurationMs(messages, 2)).toBe(3000);
  });

  test('returns null when the end cannot be measured', () => {
    expect(responseRunDurationMs([{ role: 'user', startedAt: 1000 }], 0)).toBeNull();
    expect(responseRunDurationMs([], 0)).toBeNull();
    expect(responseRunDurationMs([{ role: 'user', startedAt: 1000 }, {}], 1)).toBeNull();
  });

  test('returns null for a non-positive span', () => {
    const messages = [{ role: 'user', startedAt: 5000 }, { startedAt: 5000 }];
    expect(responseRunDurationMs(messages, 1)).toBeNull();
    const backwards = [{ role: 'user', startedAt: 5000 }, { startedAt: 1000 }];
    expect(responseRunDurationMs(backwards, 1)).toBeNull();
  });

  test('a user turn with no timestamp stops the walk and leaves the run unmeasurable', () => {
    const messages = [{ startedAt: 100 }, { role: 'user' }, { startedAt: 5000 }];
    expect(responseRunDurationMs(messages, 2)).toBeNull();
  });

  test('ignores intervening fragments without a usable timestamp', () => {
    const messages = [{ role: 'user', startedAt: 1000 }, {}, { startedAt: 4000 }];
    expect(responseRunDurationMs(messages, 2)).toBe(3000);
  });

  test('ignores a "Today, …" label for the start but still resolves it for the end', () => {
    const messages = [{ role: 'user', date: 'not a date' }, { date: 'Today, 10:30 AM' }];
    expect(responseRunDurationMs(messages, 1)).toBeNull();
  });
});

describe('parseEditOutput', () => {
  test('splits a header and its numbered rows from prose', () => {
    const text = ['[src/a.ts]', '1:const x = 1;', '2:export { x };'].join('\n');
    const sections = parseEditOutput(text);
    expect(sections).toHaveLength(1);
    expect(sections[0].path).toBe('src/a.ts');
    expect(sections[0].tag).toBeUndefined();
    expect(sections[0].lines).toEqual(['1:const x = 1;', '2:export { x };']);
    expect(sections[0].notes).toEqual([]);
  });

  test('strips a 4-hex snapshot tag from the header', () => {
    const sections = parseEditOutput('[src/a.ts#1a2B]\n10:x');
    expect(sections[0].path).toBe('src/a.ts');
    expect(sections[0].tag).toBe('1a2B');
  });

  test('keeps a non-hex suffix as part of the path', () => {
    const sections = parseEditOutput('[src/a.ts#zzz]\n1:x');
    expect(sections[0].path).toBe('src/a.ts#zzz');
  });

  test('groups multiple files in order', () => {
    const sections = parseEditOutput(['[a.ts]', '1:a', '', '[b.ts]', '2:b'].join('\n'));
    expect(sections.map((s) => s.path)).toEqual(['a.ts', 'b.ts']);
    expect(sections[1].lines).toEqual(['2:b']);
  });

  test('a bracketed path with no rows following is prose, not a group', () => {
    const sections = parseEditOutput('[src/a.ts] could not be read');
    expect(sections[0].path).toBeUndefined();
    expect(sections[0].notes).toEqual(['[src/a.ts] could not be read']);
  });

  test('rows end at the first non-row, which becomes a note', () => {
    const sections = parseEditOutput(['[a.ts]', '1:one', 'warning: watch out', '2:two'].join('\n'));
    expect(sections[0].lines).toEqual(['1:one']);
    expect(sections[0].notes).toEqual(['warning: watch out', '2:two']);
  });

  test('drops the bare and bracketed elision markers', () => {
    const sections = parseEditOutput(
      ['[a.ts]', '1:one', '…', '2:two', '[115ln elided; re-read needed ranges]', '[Showing lines 3-4 of 20]'].join('\n'),
    );
    expect(sections[0].lines).toEqual(['1:one', '2:two']);
    expect(sections[0].notes).toEqual([]);
  });

  test('a result with no group at all survives as notes', () => {
    const sections = parseEditOutput('Could not find a close enough match');
    expect(sections).toHaveLength(1);
    expect(sections[0].path).toBeUndefined();
    expect(sections[0].notes).toEqual(['Could not find a close enough match']);
  });

  test('drops a section that is only blank prose', () => {
    expect(parseEditOutput('\n\n   \n')).toEqual([]);
    expect(parseEditOutput('')).toEqual([]);
  });

  test('an empty line inside prose is preserved as paragraph spacing', () => {
    const sections = parseEditOutput(['first para', '', 'second para'].join('\n'));
    expect(sections[0].notes).toEqual(['first para', '', 'second para']);
  });

  test('handles CRLF input', () => {
    const sections = parseEditOutput('[a.ts]\r\n1:x\r\n2:y');
    expect(sections[0].lines).toEqual(['1:x', '2:y']);
  });
});

describe('capitalizeFirstLetter', () => {
  test('uppercases the first letter and preserves the rest', () => {
    expect(capitalizeFirstLetter('hello world')).toBe('Hello world');
  });

  test('preserves leading whitespace', () => {
    expect(capitalizeFirstLetter('  hello')).toBe('  Hello');
  });

  test('handles accented letters', () => {
    expect(capitalizeFirstLetter('éclair')).toBe('Éclair');
    expect(capitalizeFirstLetter('ñoño')).toBe('Ñoño');
  });

  test('returns the input unchanged without a cased letter', () => {
    expect(capitalizeFirstLetter('123 abc')).toBe('123 abc');
    expect(capitalizeFirstLetter('')).toBe('');
  });
});

describe('isSkippedTool', () => {
  const call = (partial: Partial<ToolCallData>): ToolCallData => ({ id: '1', type: 'read', title: '', ...partial });

  test('flags the synthetic, skipped and aborted rows', () => {
    expect(isSkippedTool(call({ synthetic: true }))).toBe(true);
    expect(isSkippedTool(call({ status: 'skipped' }))).toBe(true);
    expect(isSkippedTool(call({ status: 'aborted' }))).toBe(true);
  });

  test('flags the details markers', () => {
    expect(isSkippedTool(call({ details: { __synthetic: true } }))).toBe(true);
    expect(isSkippedTool(call({ details: { source: 'assistant_stop_skipped' } }))).toBe(true);
    expect(isSkippedTool(call({ details: { executed: false } }))).toBe(true);
  });

  test('leaves an actually executed call alone', () => {
    expect(isSkippedTool(call({ status: 'success', details: { executed: true } }))).toBe(false);
    expect(isSkippedTool(call({}))).toBe(false);
  });
});

describe('normalizeNoticeText', () => {
  test('strips ANSI escapes', () => {
    expect(normalizeNoticeText('\x1b[38;2;107;114;128mhello\x1b[0m')).toBe('hello');
  });

  test('strips system-notice wrappers but not runtime-notice tags', () => {
    expect(normalizeNoticeText('<system-notice>note</system-notice>')).toBe('note');
    expect(normalizeNoticeText('<system-reminder>keep</system-reminder>')).toBe(
      '<system-reminder>keep</system-reminder>',
    );
  });

  test('trims surrounding whitespace', () => {
    expect(normalizeNoticeText('  \n text \n ')).toBe('text');
  });
});

describe('detectOutputFormat', () => {
  test('empty or whitespace input is text', () => {
    expect(detectOutputFormat('')).toBe('text');
    expect(detectOutputFormat('   \n  ')).toBe('text');
  });

  test('a fenced code block is always markdown, even with HTML/JSON inside', () => {
    expect(detectOutputFormat('```html\n<div>x</div>\n```')).toBe('markdown');
    expect(detectOutputFormat('```json\n{"a":1}\n```')).toBe('markdown');
  });

  test('a JSON object or array is json, but primitives are not', () => {
    expect(detectOutputFormat('{"a":1}')).toBe('json');
    expect(detectOutputFormat('[1,2,3]')).toBe('json');
    expect(detectOutputFormat('"just a string"')).toBe('text');
    expect(detectOutputFormat('42')).toBe('text');
  });

  test('markdown cues win over html', () => {
    expect(detectOutputFormat('# Heading')).toBe('markdown');
    expect(detectOutputFormat('- a\n- b')).toBe('markdown');
    expect(detectOutputFormat('`inline`')).toBe('markdown');
    expect(detectOutputFormat('> quoted')).toBe('markdown');
    expect(detectOutputFormat('[x](https://a.test)')).toBe('markdown');
  });

  test('a leading known tag or a complete tag pair is html', () => {
    expect(detectOutputFormat('<div>hi</div>')).toBe('html');
    expect(detectOutputFormat('<!doctype html><html></html>')).toBe('html');
    expect(detectOutputFormat('<span>a</span> trailing')).toBe('html');
  });

  test('plain prose containing angle brackets is text', () => {
    expect(detectOutputFormat('the value is < 5 and > 2')).toBe('text');
    expect(detectOutputFormat('a < b')).toBe('text');
  });
});
