/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `trace` rail belongs to the RUN, and this is where that rule is pinned.
 *
 * The defect it prevents: the rail was drawn per BLOCK. Measured in the browser
 * on the 39-call sample session, that produced three disconnected segments with
 * gaps of 256px and 99px, because a turn is several message rows (thinking +
 * tools, then a notice, then the answer) and prose sits between them. A line
 * whose only job is "these steps are one sequence" cannot break at every row.
 *
 * The grouping is pure so this suite needs no DOM: mounting a real timeline is
 * heavy enough to disturb the runner's file loading, and the rule itself has
 * nothing to do with rendering.
 */

import { describe, expect, test } from 'bun:test';
import { groupTraceRows, hasTraceContent } from '@/shared/lib/chat/timeline/trace-groups';
import { traceInset } from '@/shared/lib/chat/timeline/block-chrome';
import type { ChatMessageData } from '@/shared/types/chat';

const tool = { id: 'c1', type: 'bash', name: 'bash', title: 'Bash', status: 'success' };

/** A turn as omp writes it: thinking + tools, then a notice row, then prose. */
const TURN = [
  { id: 'u1', role: 'user', content: 'run it' },
  { id: 'a1', role: 'ai', thinking: { thought: 'Consider the suite.' }, toolCalls: [tool], content: '' },
  { id: 'n1', role: 'ai', content: '', notice: 'Reminder: one thing\nSecond line' },
  { id: 'a2', role: 'ai', content: 'All done.' },
] as unknown as ChatMessageData[];

describe('trace grouping', () => {
  test('a whole turn is ONE group, so it draws one rail', () => {
    const groups = groupTraceRows(TURN);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ key: 'u1', rows: [0], trace: false });
    expect(groups[1]).toEqual({ key: 'a1', rows: [1, 2, 3], trace: true });
  });

  test('a user row closes the run: two turns are two groups', () => {
    const twoTurns = [
      ...TURN,
      { id: 'u2', role: 'user', content: 'again' },
      { id: 'a3', role: 'ai', toolCalls: [{ ...tool, id: 'c2' }], content: '' },
    ] as unknown as ChatMessageData[];
    const groups = groupTraceRows(twoTurns);
    expect(groups.map((group) => group.rows)).toEqual([[0], [1, 2, 3], [4], [5]]);
    expect(groups.filter((group) => group.trace)).toHaveLength(2);
  });

  test('a run of pure prose draws no rail', () => {
    const prose = [
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 'a1', role: 'ai', content: 'Just an answer.' },
    ] as unknown as ChatMessageData[];
    const groups = groupTraceRows(prose);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.trace === false)).toBe(true);
  });

  test('trace content on ANY row marks the whole run', () => {
    const late = [
      { id: 'u1', role: 'user', content: 'go' },
      { id: 'a1', role: 'ai', content: 'Thinking out loud.' },
      { id: 'a2', role: 'ai', toolCalls: [tool], content: '' },
    ] as unknown as ChatMessageData[];
    const groups = groupTraceRows(late);
    expect(groups[1].rows).toEqual([1, 2]);
    expect(groups[1].trace).toBe(true);
  });

  test('a window groups only the rows it covers', () => {
    const groups = groupTraceRows(TURN, 2, 4);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toEqual([2, 3]);
    // Row 2 is the notice, which carries trace content on its own.
    expect(groups[0].trace).toBe(true);
  });

  test('a truncated run keeps the key of its first row, so a window shift cannot remount it', () => {
    // The timeline mounts a WINDOW of rows, so the run is routinely rendered
    // from the middle. Keying the group by `rows[0]` renamed it every time a
    // measurement moved `start` by one row, and a renamed key remounts the
    // whole run — which threw away the thinking accordion's own open state
    // (measured: one expand removed and re-added all 14 rows of the run).
    const whole = groupTraceRows(TURN, 1, 4);
    const shifted = groupTraceRows(TURN, 2, 4);
    expect(whole[0].key).toBe('a1');
    expect(shifted[0].key).toBe(whole[0].key);
  });

  test('hasTraceContent reads each shape omp writes', () => {
    expect(hasTraceContent({ id: 'x', role: 'ai', content: '', notice: 'n' } as unknown as ChatMessageData)).toBe(true);
    expect(hasTraceContent({ id: 'x', role: 'ai', content: '', thinking: { thought: 't' } } as unknown as ChatMessageData)).toBe(true);
    expect(hasTraceContent({ id: 'x', role: 'ai', content: '', monologue: 'm' } as unknown as ChatMessageData)).toBe(true);
    expect(hasTraceContent({ id: 'x', role: 'ai', content: '', toolCalls: [tool] } as unknown as ChatMessageData)).toBe(true);
    expect(hasTraceContent({ id: 'x', role: 'ai', content: 'plain' } as unknown as ChatMessageData)).toBe(false);
  });
});

/**
 * The inset that keeps the rail off the content.
 *
 * Measured defect: the rail sat at x=315 in a 1440px window while the answer's
 * `<p>`/`<ul>` started at 311 — the line ran 4px INSIDE the first character.
 * A trace block reserves the column itself (`mx-3` + `pl-4`); prose, a notice
 * body, a diagnostic note and the summary card reserve nothing, so they need
 * this inset.
 */
describe('traceInset', () => {
  test('only the trace style, and only off a phone, insets content', () => {
    expect(traceInset('trace', false)).toBe('ml-4');
    expect(traceInset('trace', false, true)).toBe('ml-5');
    expect(traceInset('trace', true)).toBe('');
    expect(traceInset('card', false)).toBe('');
    expect(traceInset('compact', false)).toBe('');
    expect(traceInset('minimal', false)).toBe('');
  });

  test('a boxed element clears the node, a text element only needs the rail', () => {
    // The rail occupies 15.5–16.5px and the node 12–20px from the container.
    // `ml-4` (16px) clears the line for transparent prose; `ml-5` (20px) clears
    // the node too, so a background or a left border is never crossed.
    const px = (cls: string) => Number(cls.replace('ml-', '')) * 4;
    expect(px(traceInset('trace', false))).toBe(16);
    expect(px(traceInset('trace', false, true))).toBe(20);
    expect(px(traceInset('trace', false, true))).toBeGreaterThan(16.5);
  });
});
