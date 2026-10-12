/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The tolerant reader for a tool call's arguments WHILE they stream.
 *
 * The rule under test is the one that matters: a value is reported only once
 * it is provably complete. A tool call's arguments arrive as fragments, so a
 * reader that closed the brackets and hoped would show `{"timeout": 30` as
 * `30` — and the next fragment could make it `300`. Every case below is either
 * a fragment shape measured from a real stream or the boundary of that rule.
 */

import { describe, expect, test } from 'bun:test';
import { parsePartialJsonObject } from '@/shared/lib/omp/session/partial-json';

describe('parsePartialJsonObject', () => {
  test('parses a closed object outright', () => {
    expect(parsePartialJsonObject('{"command":"echo hi","i":"Running"}')).toEqual({ command: 'echo hi', i: 'Running' });
  });

  test('keeps the complete pairs of a truncated object and drops the open one', () => {
    expect(parsePartialJsonObject('{"command":"echo hi","i":"Runn')).toEqual({ command: 'echo hi' });
    expect(parsePartialJsonObject('{"a":1,"b":')).toEqual({ a: 1 });
    expect(parsePartialJsonObject('{"a":1,')).toEqual({ a: 1 });
  });

  test('reports no keys until the first pair is complete', () => {
    // The opening fragments of a real stream: `{`, `{"comm`, `{"command":`.
    // An object buffer with nothing provable yet is `{}`, the same value omp's
    // own `parseStreamingJson` returns for an empty or unrecoverable buffer —
    // and `parseMessageBlocks` reads an empty record exactly like no arguments.
    for (const fragment of ['{', '{"comm', '{"command"', '{"command":', '{"command":"ec']) {
      expect(parsePartialJsonObject(fragment)).toEqual({});
    }
  });

  test('never reports a value whose delimiter has not arrived', () => {
    // `30` may still grow to `300`, and `true` to `trueish` — neither is a
    // token until something ends it, so the pair is withheld entirely.
    expect(parsePartialJsonObject('{"timeout":30')).toEqual({});
    expect(parsePartialJsonObject('{"n":30}')).toEqual({ n: 30 });
    expect(parsePartialJsonObject('{"n":30,')).toEqual({ n: 30 });
    expect(parsePartialJsonObject('{"ok":true')).toEqual({});
    expect(parsePartialJsonObject('{"ok":true}')).toEqual({ ok: true });
  });

  test('drops a pair whose value is still streaming, keeping the earlier ones', () => {
    expect(parsePartialJsonObject('{"path":"a.ts","content":"line1\\nline2')).toEqual({ path: 'a.ts' });
    expect(parsePartialJsonObject('{"path":"a.ts","content":"line1\\nline2"}'))
      .toEqual({ path: 'a.ts', content: 'line1\nline2' });
  });

  test('keeps a completed array and drops an incomplete one', () => {
    expect(parsePartialJsonObject('{"paths":["a.ts"]}')).toEqual({ paths: ['a.ts'] });
    expect(parsePartialJsonObject('{"paths":["a.ts"')).toEqual({});
    expect(parsePartialJsonObject('{"paths":["a.ts","b')).toEqual({});
  });

  test('handles nested objects and escapes', () => {
    expect(parsePartialJsonObject('{"a":{"b":{"c":1}}}')).toEqual({ a: { b: { c: 1 } } });
    // An OPEN nested object is withheld rather than reported as `{}`.
    expect(parsePartialJsonObject('{"a":{"b":{"c":1')).toEqual({});
    expect(parsePartialJsonObject('{"q":"say \\"hi\\""}')).toEqual({ q: 'say "hi"' });
    expect(parsePartialJsonObject('{"q":"say \\"hi')).toEqual({});
  });

  test('answers undefined for anything that is not an object', () => {
    for (const input of [undefined, '', '   ', '[]', '"str"', '42', 'null', '{"a":1} trailing']) {
      expect(parsePartialJsonObject(input)).toBeUndefined();
    }
  });

  test('a brace inside a string does not close the object early', () => {
    expect(parsePartialJsonObject('{"cmd":"echo }"}')).toEqual({ cmd: 'echo }' });
    expect(parsePartialJsonObject('{"cmd":"echo }","more":1}')).toEqual({ cmd: 'echo }', more: 1 });
  });
});
