/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The batch selection split.
 *
 * The reported failure was a selection the sidebar itself made — "select all"
 * over an imported history — refused by the route's own bound with
 * `400 At most 500 sessions can be deleted at once.` The client now splits that
 * selection into requests of the route's size, so these cases hold the seam
 * between the two: chunk boundaries, order, and the empty selection that must
 * not become a request.
 */

import { describe, expect, test } from 'bun:test';
import { chunkIds, SESSION_BATCH_LIMIT } from '@/shared/lib/sessions/batch-limits';

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `id-${index}`);
}

describe('chunkIds', () => {
  test('an empty selection yields no request', () => {
    expect(chunkIds([], SESSION_BATCH_LIMIT)).toEqual([]);
  });

  test('a selection at the bound is ONE request, not two', () => {
    const selection = ids(SESSION_BATCH_LIMIT);
    expect(chunkIds(selection, SESSION_BATCH_LIMIT)).toEqual([selection]);
  });

  test('one id past the bound is two requests, in order and complete', () => {
    const selection = ids(SESSION_BATCH_LIMIT + 1);
    const chunks = chunkIds(selection, SESSION_BATCH_LIMIT);
    expect(chunks.map((chunk) => chunk.length)).toEqual([SESSION_BATCH_LIMIT, 1]);
    expect(chunks.flat()).toEqual(selection);
  });

  test('a large selection keeps every id exactly once', () => {
    const selection = ids(SESSION_BATCH_LIMIT * 2 + 37);
    const chunks = chunkIds(selection, SESSION_BATCH_LIMIT);
    expect(chunks.map((chunk) => chunk.length)).toEqual([SESSION_BATCH_LIMIT, SESSION_BATCH_LIMIT, 37]);
    expect(chunks.flat()).toEqual(selection);
  });

  test('a zero step is refused instead of looping forever', () => {
    expect(() => chunkIds(['a'], 0)).toThrow('positive integer');
  });
});
