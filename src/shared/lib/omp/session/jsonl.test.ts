/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Lenient JSONL + header parsing (`jsonl.ts`).
 *
 * These helpers read a session file's *prefix window*: the window can end
 * mid-line, mid-string, or mid-escape, and omp may have been killed mid-write.
 * The whole sidebar depends on them, so the risky behaviors pinned here are:
 * one torn line must never abort the parse of its healthy neighbors, a
 * truncated string value must still yield a usable fragment rather than
 * `undefined`, and the header scan must fall back to raw text when the header
 * line straddles the window (the case the parsed-entry path cannot see).
 */

import { describe, expect, test } from 'bun:test';

import {
  countMessageMarkers,
  extractStringProperty,
  extractTextFromContent,
  parseJsonlLenient,
  parseSessionListHeader,
} from '@/shared/lib/omp/session/jsonl';

describe('parseJsonlLenient', () => {
  test('parses one value per non-blank line and tolerates a missing trailing newline', () => {
    const body = '{"a":1}\n\n   \n{"a":2}';
    expect(parseJsonlLenient<{ a: number }>(body)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  test('skips a torn line but keeps every valid neighbor', () => {
    const body = '{"id":"one"}\n{"id":"torn"\nnot json at all\n{"id":"two"}';
    expect(parseJsonlLenient<{ id: string }>(body)).toEqual([{ id: 'one' }, { id: 'two' }]);
  });

  test('skips a line whose JSON is malformed even when it starts valid', () => {
    expect(parseJsonlLenient('{"a":1,}')).toEqual([]);
  });

  test('is empty for an empty or whitespace-only body', () => {
    expect(parseJsonlLenient('')).toEqual([]);
    expect(parseJsonlLenient('\n\n  \t\n')).toEqual([]);
  });

  test('handles CRLF line endings without leaving a stray carriage return', () => {
    expect(parseJsonlLenient<{ a: number }>('{"a":1}\r\n{"a":2}\r\n')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  test('returns non-object JSON values too — the lenient parse applies no entry filter', () => {
    // Callers cast the result to their record type; a scalar line is passed
    // through rather than dropped, so the parser stays a faithful splitter.
    expect(parseJsonlLenient('42\n"x"\n[1,2]\nnull')).toEqual([42, 'x', [1, 2], null]);
  });
});

describe('extractTextFromContent', () => {
  test('passes a plain string through unchanged', () => {
    expect(extractTextFromContent('hello')).toBe('hello');
  });

  test('joins text blocks with a single space and ignores non-text blocks', () => {
    const content = [
      { type: 'text', text: 'first' },
      { type: 'image', data: 'AAAA' },
      { type: 'text', text: 'second' },
    ];
    expect(extractTextFromContent(content)).toBe('first second');
  });

  test('ignores a text block whose text is not a string', () => {
    expect(extractTextFromContent([{ type: 'text', text: 7 }, { type: 'text', text: 'ok' }])).toBe('ok');
  });

  test('is empty for a non-string, non-array content', () => {
    expect(extractTextFromContent(7)).toBe('');
    expect(extractTextFromContent(null)).toBe('');
    expect(extractTextFromContent(undefined)).toBe('');
  });
});

describe('extractStringProperty', () => {
  test('reads a string value that follows whitespace after the colon', () => {
    expect(extractStringProperty('{"id" :  "abc"}', 'id')).toBe('abc');
  });

  test('is undefined for a missing property or a non-string value', () => {
    expect(extractStringProperty('{"x":1}', 'id')).toBeUndefined();
    expect(extractStringProperty('{"id":5}', 'id')).toBeUndefined();
  });

  test('decodes JSON escapes inside the value', () => {
    expect(extractStringProperty('{"id":"a\\nb\\t\\"c\\""}', 'id')).toBe('a\nb\t"c"');
  });

  test('an escaped quote does not terminate the value', () => {
    expect(extractStringProperty('{"id":"a\\"b","n":1}', 'id')).toBe('a"b');
  });

  test('returns the fragment when the prefix window cuts the value short', () => {
    // The window can end mid-string; a usable fragment beats `undefined`,
    // because the sidebar title/first-message scan has nothing else to read.
    expect(extractStringProperty('{"id":"abc', 'id')).toBe('abc');
  });

  test('drops a dangling backslash at the window edge instead of failing', () => {
    expect(extractStringProperty('{"id":"ab\\', 'id')).toBe('ab');
  });

  test('startIndex selects a later occurrence of the same property', () => {
    const source = '{"id":"first"}\n{"id":"second"}';
    expect(extractStringProperty(source, 'id')).toBe('first');
    expect(extractStringProperty(source, 'id', 12)).toBe('second');
  });
});

describe('countMessageMarkers', () => {
  test('counts only entries whose type is "message"', () => {
    const body = '{"type":"message"}\n{"type":"title"}\n{"type":"message"}';
    expect(countMessageMarkers(body)).toBe(2);
  });

  test('tolerates whitespace around the colon', () => {
    expect(countMessageMarkers('{"type" : "message"}')).toBe(1);
  });

  test('is zero when no type marker is present', () => {
    expect(countMessageMarkers('{"a":1}')).toBe(0);
  });
});

describe('parseSessionListHeader', () => {
  const sessionEntry = { type: 'session', id: 's1', cwd: '/work', title: 'Header title', timestamp: '2026-01-02T03:04:05.000Z' };

  test('reads the header fields from a parsed session entry', () => {
    expect(parseSessionListHeader('', [sessionEntry])).toEqual({
      id: 's1',
      cwd: '/work',
      title: 'Header title',
      parentSession: undefined,
      timestamp: '2026-01-02T03:04:05.000Z',
    });
  });

  test('a title slot overrides the header title', () => {
    const entries = [{ type: 'title', title: 'Renamed' }, sessionEntry];
    expect(parseSessionListHeader('', entries)?.title).toBe('Renamed');
  });

  test('a blank title slot suppresses the header title instead of falling back', () => {
    // An empty title slot is a deliberate "no title" — the session must render
    // its timestamped default, not the stale header title.
    const entries = [{ type: 'title', title: '   ' }, sessionEntry];
    expect(parseSessionListHeader('', entries)).toEqual({ id: 's1', cwd: '/work', title: undefined, parentSession: undefined, timestamp: '2026-01-02T03:04:05.000Z' });
  });

  test('is undefined when the first entry is neither title nor session', () => {
    expect(parseSessionListHeader('', [{ type: 'message', id: 'm1' }])).toBeUndefined();
    expect(parseSessionListHeader('', [{ type: 'session' }])).toBeUndefined();
  });

  test('falls back to a raw-text scan when no parsed entry holds the header', () => {
    const content = '{"type":"session","id":"s2","cwd":"/x","title":"Raw"}';
    expect(parseSessionListHeader(content, [])).toEqual({ id: 's2', cwd: '/x', title: 'Raw', parentSession: undefined, timestamp: undefined });
  });

  test('the raw scan honours a leading title slot line', () => {
    const content = '{"type":"title","title":"Slot"}\n{"type":"session","id":"s3","title":"Header"}';
    expect(parseSessionListHeader(content, [])?.title).toBe('Slot');
  });

  test('the raw scan only accepts a header on the first non-empty line', () => {
    const content = '{"type":"message","id":"m1"}\n{"type":"session","id":"s4"}';
    expect(parseSessionListHeader(content, [])).toBeUndefined();
  });
});
