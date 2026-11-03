/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The OMP config row's text → value conversion.
 *
 * Pinned because a bad draft used to revert SILENTLY: a trailing comma in a
 * JSON array or a half-typed number simply did not save, with nothing on screen
 * to say why. Each case here is a draft a user can produce with one keystroke
 * too many.
 */

import { describe, expect, test } from 'bun:test';
import {
  parseDraft,
  parseFiniteNumber,
  parseJsonArray,
  parseJsonRecord,
  valueToText,
  valuesEqual,
} from '@/shared/lib/omp/config/row-value';

describe('valueToText', () => {
  test('scalars print themselves and containers print JSON', () => {
    expect(valueToText('titanium')).toBe('titanium');
    expect(valueToText(42)).toBe('42');
    expect(valueToText(false)).toBe('false');
    expect(valueToText(['anthropic', 'openai'])).toBe('["anthropic","openai"]');
    expect(valueToText({ bash: 'prompt' })).toBe('{"bash":"prompt"}');
  });

  test('an unset value is an empty field, not the text "undefined"', () => {
    expect(valueToText(undefined)).toBe('');
    expect(valueToText(null)).toBe('');
  });
});

describe('parseFiniteNumber', () => {
  test('a partial entry is not a number', () => {
    expect(parseFiniteNumber('')).toBeNull();
    expect(parseFiniteNumber('-')).toBeNull();
    expect(parseFiniteNumber('+')).toBeNull();
    expect(parseFiniteNumber('.')).toBeNull();
    expect(parseFiniteNumber('abc')).toBeNull();
  });

  test('a finite number survives surrounding whitespace', () => {
    expect(parseFiniteNumber(' 1200 ')).toBe(1200);
    expect(parseFiniteNumber('-0.5')).toBe(-0.5);
  });
});

describe('parseDraft', () => {
  test('a number row names what it wants instead of reverting', () => {
    expect(parseDraft('number', '12')).toEqual({ ok: true, value: 12 });
    expect(parseDraft('number', '')).toMatchObject({ ok: false });
  });

  test('a string row keeps an empty value — clearing a credential is a write', () => {
    expect(parseDraft('string', '  ')).toEqual({ ok: true, value: '' });
    expect(parseDraft('string', ' sk-live ')).toEqual({ ok: true, value: 'sk-live' });
  });

  test('an array row accepts a JSON array and rejects anything else', () => {
    expect(parseDraft('array', '["a"]')).toEqual({ ok: true, value: ['a'] });
    expect(parseDraft('array', '')).toEqual({ ok: true, value: [] });
    expect(parseDraft('array', '["a",]')).toMatchObject({ ok: false });
    expect(parseDraft('array', '{"a":1}')).toMatchObject({ ok: false });
    expect(parseDraft('array', 'nope')).toMatchObject({ ok: false });
  });

  test('a record row accepts a JSON object and rejects an array', () => {
    expect(parseDraft('record', '{"bash":"prompt"}')).toEqual({ ok: true, value: { bash: 'prompt' } });
    expect(parseDraft('record', '')).toEqual({ ok: true, value: {} });
    expect(parseDraft('record', '[]')).toMatchObject({ ok: false });
  });
});

describe('json helpers', () => {
  test('a non-array and a non-object parse to null', () => {
    expect(parseJsonArray('7')).toBeNull();
    expect(parseJsonRecord('"x"')).toBeNull();
    expect(parseJsonArray('[1,2]')).toEqual([1, 2]);
    expect(parseJsonRecord('{"a":1}')).toEqual({ a: 1 });
  });

  test('valuesEqual compares depth-first, ignoring key-independent order', () => {
    expect(valuesEqual(['a'], ['a'])).toBe(true);
    expect(valuesEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(valuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(valuesEqual(1, '1')).toBe(false);
  });
});
