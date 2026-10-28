/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * These tests pin the hand-rolled XML scanner, which parses arbitrary tool
 * output and must never invent a tag. They cover both halves:
 *
 * - the tokenizer — attribute parsing, finding a tag's closing `>` (which may
 *   hide inside a quoted value), and recognizing the markup that opens a tag;
 * - the element scan — common-indent removal and whole-element scanning with
 *   depth counting, where an unterminated or mismatched element must be
 *   `undefined` rather than a partial element.
 *
 * The malformed cases (a lone `=`, a digit-leading name, an unterminated quote
 * or comment, an unclosed fence) are as important as the happy path: each one
 * is what keeps a stray `<` in a log or a rule's own code sample from being
 * read as markup.
 */

import { describe, expect, test } from 'bun:test';

import { parseAttributes, readTag, scanElement, stripCommonIndent, tagEnd } from '@/shared/lib/chat/xml-tag';

describe('parseAttributes', () => {
  test('reads double-quoted, single-quoted, unquoted and valueless attributes', () => {
    expect(parseAttributes('reason="rule_violation" flag a=1 b=\'two\' c=three')).toEqual({
      reason: 'rule_violation',
      flag: '',
      a: '1',
      b: 'two',
      c: 'three',
    });
  });

  test('keeps a `>` that sits inside a quoted value', () => {
    expect(parseAttributes('a="x>y" b=\'p>q\'')).toEqual({ a: 'x>y', b: 'p>q' });
  });

  test('a duplicate name keeps the last value', () => {
    expect(parseAttributes('a="1" a="2"')).toEqual({ a: '2' });
  });

  test('an attribute name with `=` but no value parses as valueless', () => {
    expect(parseAttributes('flag=')).toEqual({ flag: '' });
  });

  test('skips a malformed tail that cannot start a name', () => {
    expect(parseAttributes('=2 a="1"')).toEqual({ a: '1' });
    expect(parseAttributes('1x a=2')).toEqual({ x: '', a: '2' });
  });

  test('an empty string has no attributes', () => {
    expect(parseAttributes('')).toEqual({});
  });
});

describe('tagEnd', () => {
  test('returns the index of the closing `>`', () => {
    expect(tagEnd('<a>', 0)).toBe(2);
  });

  test('skips `>` characters inside a double-quoted value', () => {
    expect(tagEnd('a="b>c">', 0)).toBe(7);
  });

  test('skips `>` characters inside a single-quoted value', () => {
    expect(tagEnd("a='>'>", 0)).toBe(5);
  });

  test('a self-closing `/>` closes at its `>`', () => {
    expect(tagEnd('<foo/>', 0)).toBe(5);
  });

  test('returns -1 when the tag is never terminated', () => {
    expect(tagEnd('<foo', 0)).toBe(-1);
    expect(tagEnd('a="unclosed>', 0)).toBe(-1);
  });

  test('a backslash does not escape the quote, so the value never closes', () => {
    expect(tagEnd('a="b\\"c">', 0)).toBe(-1);
  });
});

describe('readTag', () => {
  test('reads a start tag with its raw attribute text', () => {
    expect(readTag('<foo bar="1">', 0)).toEqual({
      kind: 'start',
      name: 'foo',
      attrs: ' bar="1"',
      end: 13,
    });
  });

  test('reads an end tag', () => {
    expect(readTag('</foo>', 0)).toEqual({ kind: 'end', name: 'foo', attrs: '', end: 6 });
  });

  test('reads a self-closing tag as `self`', () => {
    expect(readTag('<foo/>', 0)).toEqual({ kind: 'self', name: 'foo', attrs: '/', end: 6 });
  });

  test('a name may contain dots, colons, dashes and underscores', () => {
    expect(readTag('<a.b:c-d_1>', 0)?.name).toBe('a.b:c-d_1');
  });

  test('reads a comment as `other`, not as a tag', () => {
    expect(readTag('<!-- <b> -->', 0)).toEqual({ kind: 'other', name: '', attrs: '', end: 12 });
  });

  test('an unterminated comment is malformed', () => {
    expect(readTag('<!-- x', 0)).toBeUndefined();
  });

  test('reads CDATA as `other` so its contents are never tags', () => {
    expect(readTag('<![CDATA[ <a> ]]>', 0)).toEqual({ kind: 'other', name: '', attrs: '', end: 17 });
  });

  test('reads a doctype and a processing instruction as `other`', () => {
    expect(readTag('<!DOCTYPE html>', 0)?.kind).toBe('other');
    expect(readTag('<?xml version="1.0"?>', 0)?.kind).toBe('other');
  });

  test('is undefined when the position is not a `<`', () => {
    expect(readTag('abc', 0)).toBeUndefined();
    expect(readTag('  <foo>', 0)).toBeUndefined();
  });

  test('is undefined for a name that cannot start a tag', () => {
    expect(readTag('< foo>', 0)).toBeUndefined();
    expect(readTag('<1foo>', 0)).toBeUndefined();
    expect(readTag('<>', 0)).toBeUndefined();
  });

  test('is undefined when the tag is never closed', () => {
    expect(readTag('<foo', 0)).toBeUndefined();
  });
});

describe('stripCommonIndent', () => {
  test('drops the indentation every line shares', () => {
    expect(stripCommonIndent('  a\n    b')).toBe('a\n  b');
  });

  test('counts tabs and spaces as separate characters', () => {
    expect(stripCommonIndent('\t  a\n    b')).toBe('a\n b');
  });

  test('the least-indented line sets the amount removed', () => {
    expect(stripCommonIndent('a\n  b')).toBe('a\n  b');
    expect(stripCommonIndent('    a\n  b')).toBe('  a\nb');
  });

  test('drops blank lines hugging the ends but keeps inner ones', () => {
    expect(stripCommonIndent('\n  a\n\n  b\n')).toBe('a\n\nb');
  });

  test('a whitespace-only leading line is padding', () => {
    expect(stripCommonIndent('  \n  x')).toBe('x');
  });

  test('all-blank text collapses to the empty string', () => {
    expect(stripCommonIndent('\n\n')).toBe('');
    expect(stripCommonIndent('')).toBe('');
  });

  test('an unindented single line is unchanged', () => {
    expect(stripCommonIndent('x')).toBe('x');
  });
});

describe('scanElement', () => {
  test('scans a whole element with its attributes', () => {
    expect(scanElement('<a b="1">hi</a>', 0)).toEqual({
      tag: 'a',
      attributes: { b: '1' },
      inner: 'hi',
      end: 15,
    });
  });

  test('counts depth for a tag nested inside itself', () => {
    expect(scanElement('<a><a>x</a></a>', 0)).toEqual({
      tag: 'a',
      attributes: {},
      inner: '<a>x</a>',
      end: 15,
    });
  });

  test('a mismatched end tag makes the element malformed', () => {
    expect(scanElement('<a><b></a>', 0)).toBeUndefined();
  });

  test('an element that never closes is malformed', () => {
    expect(scanElement('<a>x', 0)).toBeUndefined();
  });

  test('only a start tag opens a scan', () => {
    expect(scanElement('</a>', 0)).toBeUndefined();
    expect(scanElement('<a/>', 0)).toBeUndefined();
    expect(scanElement('abc', 0)).toBeUndefined();
  });

  test('a `>` inside a quoted attribute value does not end the tag', () => {
    expect(scanElement('<a b="x>y">z</a>', 0)).toEqual({
      tag: 'a',
      attributes: { b: 'x>y' },
      inner: 'z',
      end: 16,
    });
  });

  test('a `>` in the body is text, not markup', () => {
    expect(scanElement('<a>></a>', 0)?.inner).toBe('>');
  });

  test('a double `<` is not a tag', () => {
    expect(scanElement('<<a>>', 0)).toBeUndefined();
  });

  test('an inline code span hides markup inside it', () => {
    expect(scanElement('<a>use `Promise<T>` here</a>', 0)?.inner).toBe('use `Promise<T>` here');
  });

  test('an inline span closes only at a run of the same length', () => {
    expect(scanElement('<a>``x` y``</a>', 0)?.inner).toBe('``x` y``');
    expect(scanElement('<a>`a ` b`</a>', 0)?.inner).toBe('`a ` b`');
  });

  test('a lone backtick does not swallow the end tag', () => {
    expect(scanElement('<a>`</a>', 0)?.inner).toBe('`');
  });

  test('a fence hides markup inside it', () => {
    expect(scanElement('<a>\n```\n<b>\n```\n</a>', 0)?.inner).toBe('```\n<b>\n```');
  });

  test('a closing fence run of at least the opening length closes it', () => {
    expect(scanElement('<a>\n````\n<b>\n````\n</a>', 0)?.inner).toBe('````\n<b>\n````');
    expect(scanElement('<a>\n```\n<b>\n````\n</a>', 0)?.inner).toBe('```\n<b>\n````');
  });

  test('a shorter closing run does not close the fence, so the element stays open', () => {
    expect(scanElement('<a>\n````\n<b>\n```\n</a>', 0)).toBeUndefined();
  });

  test('a comment or CDATA inside the body is skipped, not scanned as a tag', () => {
    expect(scanElement('<a><!-- <b> --></a>', 0)?.inner).toBe('<!-- <b> -->');
    expect(scanElement('<a><![CDATA[ <b> ]]></a>', 0)?.inner).toBe('<![CDATA[ <b> ]]>');
  });

  test('scanning starts at the given offset', () => {
    expect(scanElement('junk<a>x</a>', 4)?.tag).toBe('a');
  });
});
