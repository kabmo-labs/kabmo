/**
 * The update log fold. Output arrives in chunks that do not respect line
 * boundaries, so the two properties that matter are: a line is never rendered
 * in halves, and a long log keeps its tail.
 */

import { describe, expect, test } from 'bun:test';

import { appendUpdateLog, UPDATE_LOG_LIMIT, updateLogText, type UpdateLogState } from '@/shared/lib/updates/progress';

function empty(): UpdateLogState {
  return { lines: [], pending: '', truncated: false };
}

describe('appendUpdateLog', () => {
  test('a chunk split mid-line is held until its newline arrives', () => {
    const first = appendUpdateLog(empty(), 'Installing kab');
    // Nothing complete yet: the partial line is carried, not rendered as a line.
    expect(first.lines).toEqual([]);
    expect(updateLogText(first)).toBe('Installing kab');

    const second = appendUpdateLog(first, 'mo@0.7.1\n');
    expect(second.lines).toEqual(['Installing kabmo@0.7.1']);
    expect(second.pending).toBe('');
  });

  test('several lines in one chunk each become their own line', () => {
    const state = appendUpdateLog(empty(), 'one\ntwo\nthree');
    expect(state.lines).toEqual(['one', 'two']);
    expect(state.pending).toBe('three');
    expect(updateLogText(state)).toBe('one\ntwo\nthree');
  });

  test('an empty chunk does not add a line', () => {
    const state = appendUpdateLog(appendUpdateLog(empty(), 'x\n'), '');
    expect(state.lines).toEqual(['x']);
  });

  test('a log past the limit keeps the newest lines and reports the trim', () => {
    const chunk = `${'a'.repeat(1000)}\n`.repeat(30);
    const state = appendUpdateLog(empty(), chunk);

    expect(state.truncated).toBe(true);
    const length = state.lines.reduce((total, line) => total + line.length + 1, 0);
    expect(length).toBeLessThanOrEqual(UPDATE_LOG_LIMIT);
    // The tail is what survives: a failing step reports at the end.
    expect(state.lines.length).toBeLessThan(30);
    expect(state.lines.at(-1)).toBe('a'.repeat(1000));
  });

  test('a log under the limit is not marked truncated', () => {
    expect(appendUpdateLog(empty(), 'short\n').truncated).toBe(false);
  });
});
