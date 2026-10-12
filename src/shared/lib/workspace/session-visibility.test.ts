/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sidebar's pagination window.
 *
 * `selectVisibleSessions` is the one place the two sidebars decide which rows
 * the "Show more" boundary may hide, and the rule it encodes is the whole
 * point of the module: a session the operator is WATCHING — the one open in the
 * URL, one whose run is streaming, one blocked on a question — is rendered even
 * when it sits past the window. A regression here is silent on screen (the row
 * simply is not there) and the label's count would be wrong by the same rows.
 *
 * The `hiddenCount` cases are as load-bearing as the exemption ones: it feeds
 * "Show more sessions (n)", which must count only what the next click reveals.
 * The exempt rows are already rendered, so counting them overstates the
 * remainder and the button never reaches zero.
 */

import { describe, expect, test } from 'bun:test';

import { selectVisibleSessions } from '@/shared/lib/workspace/session-visibility';
import type { SessionItemData } from '@/shared/types';

/** A session carrying only the fields the window reads. */
function makeSession(id: number | string, extra: Partial<SessionItemData> = {}): SessionItemData {
  return { id, folder_id: 0, title: `session-${id}`, ...extra };
}

/** Ten sessions, ordered as the sidebar orders them: newest activity first. */
function tenSessions(): SessionItemData[] {
  return Array.from({ length: 10 }, (_, index) => makeSession(index + 1));
}

describe('selectVisibleSessions', () => {
  test('a list within the window renders whole, with nothing to reveal', () => {
    const sessions = tenSessions().slice(0, 5);
    const result = selectVisibleSessions(sessions, 5, { activeSessionId: null });

    expect(result.rendered.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.hiddenCount).toBe(0);
  });

  test('the opened session past the boundary is rendered where it sits', () => {
    const result = selectVisibleSessions(tenSessions(), 5, { activeSessionId: 8 });

    // Rendered in source order — the exemption does not lift the row to the top.
    expect(result.rendered.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 8]);
    // Only the five rows the next click actually reveals.
    expect(result.hiddenCount).toBe(4);
  });

  test('every streaming session is rendered, however many there are', () => {
    const status = { '7': 'stream', '9': 'stream' } as Record<string, string>;
    const result = selectVisibleSessions(tenSessions(), 5, { activeSessionId: null, sessionStatus: status });

    expect(result.rendered.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 7, 9]);
    expect(result.hiddenCount).toBe(3);
  });

  test('a session blocked on a question is rendered too', () => {
    const sessions = tenSessions();
    sessions[8] = makeSession(9, { awaitingInput: true });
    const result = selectVisibleSessions(sessions, 5, { activeSessionId: null });

    expect(result.rendered.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 9]);
    expect(result.hiddenCount).toBe(4);
  });

  test('a terminal badge does not exempt a row — only a live run does', () => {
    const status = { '9': 'finish', '10': 'abort' } as Record<string, string>;
    const result = selectVisibleSessions(tenSessions(), 5, { activeSessionId: null, sessionStatus: status });

    expect(result.rendered.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.hiddenCount).toBe(5);
  });

  test('with no selection the mock `is_active` row is the one that stays', () => {
    const sessions = tenSessions();
    sessions[7] = makeSession(8, { is_active: 1 });
    const result = selectVisibleSessions(sessions, 5, { activeSessionId: null });

    expect(result.rendered.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 8]);
    expect(result.hiddenCount).toBe(4);
  });

  test('an explicit selection ignores `is_active`', () => {
    const sessions = tenSessions();
    sessions[7] = makeSession(8, { is_active: 1 });
    const result = selectVisibleSessions(sessions, 5, { activeSessionId: '3' });

    // 3 is inside the window anyway; the mock flag must not add row 8.
    expect(result.rendered.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.hiddenCount).toBe(5);
  });

  test('an exempt row inside the window does not inflate the count', () => {
    const status = { '2': 'stream' } as Record<string, string>;
    const result = selectVisibleSessions(tenSessions(), 5, { activeSessionId: 2, sessionStatus: status });

    expect(result.rendered.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.hiddenCount).toBe(5);
  });

  test('the revealed count reaches zero once the window covers the list', () => {
    const first = selectVisibleSessions(tenSessions(), 5, { activeSessionId: 9 });
    expect(first.hiddenCount).toBe(4);

    // The next click grows the window by the hook's step; the exempt row is
    // now inside it and contributes nothing to the count.
    const second = selectVisibleSessions(tenSessions(), 12, { activeSessionId: 9 });
    expect(second.rendered).toHaveLength(10);
    expect(second.hiddenCount).toBe(0);
  });
});
