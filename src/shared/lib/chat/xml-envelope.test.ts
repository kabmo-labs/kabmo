/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * These tests pin the envelope layer that sits on top of the XML scanner: which
 * wrappers count as runtime notices, how a run of notices is peeled, and how a
 * notice appended AFTER output is told apart from a notice merely quoted by it.
 * The risky behavior is the boundary between transport and content — a second
 * element after a non-notice wrapper is content (`[]`), free text after the last
 * wrapper rides along as `rest`, and a trailing notice only counts when it sits
 * on its own line at the very end, so `rg` output that prints a reminder as
 * source text stays untouched.
 */

import { describe, expect, test } from 'bun:test';

import {
  isReminderTag,
  stripNoticeTags,
  takeTrailingNotice,
  unwrapXmlEnvelope,
  unwrapXmlEnvelopes,
} from '@/shared/lib/chat/xml-envelope';

describe('isReminderTag', () => {
  test('accepts the runtime-notice wrappers', () => {
    for (const tag of ['system-reminder', 'reminder', 'system-interrupt', 'system-warning', 'system-directive']) {
      expect(isReminderTag(tag)).toBe(true);
    }
  });

  test('rejects a result wrapper and a task-card wrapper', () => {
    expect(isReminderTag('result')).toBe(false);
    expect(isReminderTag('system-notice')).toBe(false);
    expect(isReminderTag('')).toBe(false);
  });
});

describe('stripNoticeTags', () => {
  test('drops a notice wrapper and keeps its text', () => {
    expect(stripNoticeTags('<system-reminder reason="x">hi</system-reminder>')).toBe('hi');
  });

  test('also drops the task-card wrappers', () => {
    expect(stripNoticeTags('<task-result>y</task-result>')).toBe('y');
    expect(stripNoticeTags('<system-notice>n</system-notice>')).toBe('n');
  });

  test('leaves a non-listed wrapper alone', () => {
    expect(stripNoticeTags('<result>z</result>')).toBe('<result>z</result>');
  });

  test('matches case-insensitively but respects a word boundary', () => {
    expect(stripNoticeTags('<SYSTEM-WARNING>w</SYSTEM-WARNING>')).toBe('w');
    expect(stripNoticeTags('<system-reminderx>no</system-reminderx>')).toBe('<system-reminderx>no</system-reminderx>');
  });
});

describe('unwrapXmlEnvelopes', () => {
  test('returns nothing for empty or whitespace-only text', () => {
    expect(unwrapXmlEnvelopes('')).toEqual([]);
    expect(unwrapXmlEnvelopes('  \n ')).toEqual([]);
  });

  test('peels a leading wrapper of any name', () => {
    expect(unwrapXmlEnvelopes('<result a="1" b="2">hi</result>')).toEqual([
      { tag: 'result', attributes: { a: '1', b: '2' }, inner: 'hi' },
    ]);
    expect(unwrapXmlEnvelopes('<div>a</div>')[0]?.tag).toBe('div');
  });

  test('free text after the closing tag rides along as `rest`', () => {
    expect(unwrapXmlEnvelopes('<result>hi</result> tail')).toEqual([
      { tag: 'result', attributes: {}, inner: 'hi', rest: 'tail' },
    ]);
  });

  test('a second element after a non-notice wrapper means there is no wrapper', () => {
    expect(unwrapXmlEnvelopes('<result>hi</result><div>x</div>')).toEqual([]);
  });

  test('text before the first tag means the tag is content', () => {
    expect(unwrapXmlEnvelopes('a <system-reminder>x</system-reminder>')).toEqual([]);
  });

  test('an unbalanced wrapper is not peeled', () => {
    expect(unwrapXmlEnvelopes('<result>hi')).toEqual([]);
  });

  test('leading whitespace is allowed', () => {
    expect(unwrapXmlEnvelopes('  <result>hi</result>')[0]?.inner).toBe('hi');
  });

  test('removes the common indent from the inner text', () => {
    expect(unwrapXmlEnvelopes('<result>\n  line1\n  line2\n</result>')[0]?.inner).toBe('line1\nline2');
  });

  test('follows a run of notice wrappers', () => {
    expect(unwrapXmlEnvelopes('<system-reminder>a</system-reminder>\n\n<system-reminder>b</system-reminder>')).toEqual([
      { tag: 'system-reminder', attributes: {}, inner: 'a' },
      { tag: 'system-reminder', attributes: {}, inner: 'b' },
    ]);
  });

  test('the run stops at a non-notice sibling, which becomes `rest`', () => {
    expect(unwrapXmlEnvelopes('<system-reminder>a</system-reminder><system-notice>b</system-notice>')).toEqual([
      { tag: 'system-reminder', attributes: {}, inner: 'a', rest: '<system-notice>b</system-notice>' },
    ]);
    expect(
      unwrapXmlEnvelopes('<system-reminder>a</system-reminder><system-reminder>b</system-reminder><div>x</div>'),
    ).toEqual([
      { tag: 'system-reminder', attributes: {}, inner: 'a' },
      { tag: 'system-reminder', attributes: {}, inner: 'b', rest: '<div>x</div>' },
    ]);
  });

  test('free text after the last notice rides on that notice', () => {
    expect(
      unwrapXmlEnvelopes('<system-reminder>a</system-reminder>\n\n<system-reminder>b</system-reminder>\ntail'),
    ).toEqual([
      { tag: 'system-reminder', attributes: {}, inner: 'a' },
      { tag: 'system-reminder', attributes: {}, inner: 'b', rest: 'tail' },
    ]);
  });

  test('re-wrapping the parsed fields reproduces the source', () => {
    const source = '<result a="1">hi</result>';
    const [envelope] = unwrapXmlEnvelopes(source);
    expect(envelope).toBeDefined();
    if (!envelope) return;
    const attrs = Object.entries(envelope.attributes)
      .map(([k, v]) => ` ${k}="${v}"`)
      .join('');
    expect(`<${envelope.tag}${attrs}>${envelope.inner}</${envelope.tag}>`).toBe(source);
  });
});

describe('unwrapXmlEnvelope', () => {
  test('returns only the first wrapper', () => {
    expect(unwrapXmlEnvelope('<system-reminder>only</system-reminder>')).toEqual({
      tag: 'system-reminder',
      attributes: {},
      inner: 'only',
    });
  });

  test('is undefined when there is no wrapper', () => {
    expect(unwrapXmlEnvelope('plain text')).toBeUndefined();
  });
});

describe('takeTrailingNotice', () => {
  test('peels a notice on its own line at the end of the output', () => {
    expect(takeTrailingNotice('out\n<system-warning>w</system-warning>')).toEqual({
      before: 'out',
      envelope: { tag: 'system-warning', attributes: {}, inner: 'w' },
    });
  });

  test('a final newline after the notice is still trailing', () => {
    expect(takeTrailingNotice('out\n<system-warning>w</system-warning>\n')?.before).toBe('out');
  });

  test('a notice with no content before it is not trailing', () => {
    expect(takeTrailingNotice('<system-warning>w</system-warning>')).toBeUndefined();
  });

  test('text after the closing tag disqualifies it', () => {
    expect(takeTrailingNotice('out\n<system-warning>w</system-warning>tail')).toBeUndefined();
  });

  test('a notice that does not start its own line is content', () => {
    expect(takeTrailingNotice('out <system-warning>w</system-warning>')).toBeUndefined();
  });

  test('a notice quoted in source code is not trailing', () => {
    expect(takeTrailingNotice('const x = "<system-warning>w</system-warning>"')).toBeUndefined();
  });

  test('a tag the notice regex does not cover is ignored', () => {
    expect(takeTrailingNotice('out\n<result>x</result>')).toBeUndefined();
    expect(takeTrailingNotice('out\n<system-notice>x</system-notice>')).toBeUndefined();
  });

  test('an unbalanced notice is not peeled', () => {
    expect(takeTrailingNotice('out\n<system-warning>unbalanced')).toBeUndefined();
  });

  test('the last notice wins and earlier text stays in `before`', () => {
    expect(takeTrailingNotice('a\n<system-reminder>x</system-reminder>\n<system-warning>y</system-warning>')).toEqual({
      before: 'a\n<system-reminder>x</system-reminder>',
      envelope: { tag: 'system-warning', attributes: {}, inner: 'y' },
    });
  });

  test('keeps the notice attributes and reports multi-line preceding text', () => {
    expect(takeTrailingNotice('line1\nline2\n<system-interrupt>stop</system-interrupt>')).toEqual({
      before: 'line1\nline2',
      envelope: { tag: 'system-interrupt', attributes: {}, inner: 'stop' },
    });
    expect(takeTrailingNotice('out\n<system-reminder a="1">x</system-reminder>')).toEqual({
      before: 'out',
      envelope: { tag: 'system-reminder', attributes: { a: '1' }, inner: 'x' },
    });
  });
});
