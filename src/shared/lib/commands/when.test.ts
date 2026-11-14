/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { compileWhen, evaluateWhen } from '@/shared/lib/commands/when';

describe('when clauses', () => {
  test('an absent clause is always true', () => {
    expect(evaluateWhen(undefined, {})).toBe(true);
    expect(evaluateWhen('', {})).toBe(true);
  });

  test('a bare key is its truthiness, and an unknown key is false', () => {
    expect(evaluateWhen('editorTextFocus', { editorTextFocus: true })).toBe(true);
    expect(evaluateWhen('editorTextFocus', { editorTextFocus: false })).toBe(false);
    expect(evaluateWhen('editorTextFocus', {})).toBe(false);
  });

  test('negation binds tighter than && and ||', () => {
    expect(evaluateWhen('!a && b', { a: false, b: true })).toBe(true);
    expect(evaluateWhen('!a && b', { a: true, b: true })).toBe(false);
    expect(evaluateWhen('a || b && c', { a: true, b: false, c: false })).toBe(true);
    expect(evaluateWhen('a || b && c', { a: false, b: true, c: false })).toBe(false);
  });

  test('parentheses override precedence', () => {
    expect(evaluateWhen('(a || b) && c', { a: true, b: false, c: false })).toBe(false);
    expect(evaluateWhen('(a || b) && c', { a: true, b: false, c: true })).toBe(true);
  });

  test('equality compares the string form, and != negates it', () => {
    expect(evaluateWhen('lang == typescript', { lang: 'typescript' })).toBe(true);
    expect(evaluateWhen("lang == 'typescript'", { lang: 'typescript' })).toBe(true);
    expect(evaluateWhen('lang != typescript', { lang: 'rust' })).toBe(true);
    expect(evaluateWhen('lang != typescript', { lang: 'typescript' })).toBe(false);
    expect(evaluateWhen('count == 3', { count: 3 })).toBe(true);
  });

  test('a malformed clause is false at evaluation and throws at compile', () => {
    expect(evaluateWhen('a &&', { a: true })).toBe(false);
    expect(evaluateWhen('(a', { a: true })).toBe(false);
    expect(() => compileWhen('a &&')).toThrow();
  });
});
