/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `extractLineMeta` decides which number the gutter starts at for a `read`
 * result, and its heuristics are tried in a fixed order. The ordering is the
 * contract: an explicit `displayContent.lineNumbers` gutter must survive even
 * when a coarser `startLine` is also present, and the derived fallbacks
 * (truncation window, input offset, a `:55-100` range in the path, an elision
 * notice inside the text) must only fire when nothing more specific does.
 *
 * Pure function, no mounting. Each case pins one rung of that ladder.
 */

import { describe, expect, test } from 'bun:test';
import { extractLineMeta } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/read-line-meta';
import type { ToolCallData } from '@/shared/types/chat';

const tool = (overrides: Partial<ToolCallData> = {}): ToolCallData =>
  ({ id: 'c1', type: 'read', title: 'read', ...overrides }) as ToolCallData;

describe('extractLineMeta', () => {
  test('returns nothing for a call with no line hints at all', () => {
    expect(extractLineMeta(tool())).toEqual({});
  });

  test('prefers the displayContent gutter over a coarser details gutter', () => {
    const meta = extractLineMeta(
      tool({
        details: {
          displayContent: { lineNumbers: [10, 11], startLine: 10 },
          lineNumbers: [1, 2],
          startLine: 1,
        },
      }),
    );
    expect(meta).toEqual({ startLine: 10, lineNumbers: [10, 11] });
  });

  test('keeps an explicit gutter even when no startLine accompanies it', () => {
    const meta = extractLineMeta(tool({ details: { displayContent: { lineNumbers: [1, 2] } } }));
    expect(meta).toEqual({ startLine: undefined, lineNumbers: [1, 2] });
  });

  test('falls back to the details gutter when displayContent has none', () => {
    const meta = extractLineMeta(tool({ details: { lineNumbers: [5, 6], startLine: 5 } }));
    expect(meta).toEqual({ startLine: 5, lineNumbers: [5, 6] });
  });

  test('takes displayContent.startLine before any details startLine', () => {
    expect(extractLineMeta(tool({ details: { displayContent: { startLine: 42 }, startLine: 7 } }))).toEqual({ startLine: 42 });
  });

  test('walks details.startLine -> start_line -> offset in order', () => {
    expect(extractLineMeta(tool({ details: { startLine: 7, start_line: 8, offset: 9 } }))).toEqual({ startLine: 7 });
    expect(extractLineMeta(tool({ details: { start_line: 8, offset: 9 } }))).toEqual({ startLine: 8 });
    expect(extractLineMeta(tool({ details: { offset: 9 } }))).toEqual({ startLine: 9 });
  });

  test('ignores a zero/negative startLine so it can fall through', () => {
    expect(extractLineMeta(tool({ details: { startLine: 0, offset: 9 } }))).toEqual({ startLine: 9 });
  });

  test('reads the truncation window start when no explicit line is set', () => {
    expect(
      extractLineMeta(tool({ details: { meta: { truncation: { shownRange: { start: 54 } } } } })),
    ).toEqual({ startLine: 54 });
    expect(extractLineMeta(tool({ details: { shownRange: { start: 55 } } }))).toEqual({ startLine: 55 });
  });

  test('reads the start line off the input, including a numeric string', () => {
    expect(extractLineMeta(tool({ input: { start_line: 3 } }))).toEqual({ startLine: 3 });
    expect(extractLineMeta(tool({ input: { startLine: '12' } }))).toEqual({ startLine: 12 });
    expect(extractLineMeta(tool({ input: { from: 1 } }))).toEqual({ startLine: 1 });
  });

  test('a specific details line beats an input offset', () => {
    expect(extractLineMeta(tool({ details: { startLine: 7 }, input: { start_line: 3 } }))).toEqual({ startLine: 7 });
  });

  test('derives the line from a range in the path or title', () => {
    expect(extractLineMeta(tool({ input: { path: 'app/types/chat.ts:55-100' } }))).toEqual({ startLine: 55 });
    expect(extractLineMeta(tool({ title: 'read src/a.ts:12' }))).toEqual({ startLine: 12 });
    expect(extractLineMeta(tool(), 'src/b.ts:99-100')).toEqual({ startLine: 99 });
  });

  test('an input start_line beats a range in the same input path', () => {
    expect(extractLineMeta(tool({ input: { start_line: 3, path: 'a.ts:99-100' } }))).toEqual({ startLine: 3 });
  });

  test('reads an elision notice out of the raw content as the last resort', () => {
    expect(extractLineMeta(tool(), undefined, '[Showing lines 54-103 of 208...]')).toEqual({ startLine: 54 });
  });

  test('a path range beats the content notice', () => {
    expect(
      extractLineMeta(tool({ input: { path: 'a.ts:7' } }), undefined, '[Showing lines 54-103 of 208...]'),
    ).toEqual({ startLine: 7 });
  });
});
