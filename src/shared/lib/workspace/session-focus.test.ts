/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The focus filter behind the modern sidebar's `Running` chip.
 *
 * Two properties are load-bearing and each is a bug if lost:
 *
 * - **a workspace with nothing running is DROPPED**, not drawn as an empty
 *   header. A focus switch that leaves a column of empty workspaces has not
 *   focused anything.
 * - **"running" means the user is waiting on this row** — a run in flight, a
 *   held prompt, or an agent blocked on a question. A `finish` badge is NOT
 *   running: it is a one-shot mark that clears when the session opens, so
 *   counting it would keep finished chats in a "running" list forever.
 */

import { describe, expect, test } from 'bun:test';
import { focusFolders, isRunningSession, runningSessionCount } from '@/shared/lib/workspace/session-focus';
import type { SessionItemData, WorkspaceFolderData } from '@/shared/types';

function session(id: string, extra: Partial<SessionItemData> = {}): SessionItemData {
  return { id, folder_id: 1, title: id, ...extra };
}

function folder(id: number, sessions: SessionItemData[]): WorkspaceFolderData {
  return {
    id,
    name: `ws-${id}`,
    isExpanded: true,
    sessions,
    hasMore: false,
    totalSessions: sessions.length,
  };
}

const statusOf = (map: Record<string, 'stream' | 'finish' | 'abort'>) =>
  (id: string) => map[id];

describe('isRunningSession', () => {
  test('a stream status is running', () => {
    expect(isRunningSession(session('a'), 'stream')).toBe(true);
  });

  test('a finished or aborted run is not running', () => {
    expect(isRunningSession(session('a'), 'finish')).toBe(false);
    expect(isRunningSession(session('a'), 'abort')).toBe(false);
  });

  test('a blocked agent and a held prompt count, with no stream status at all', () => {
    expect(isRunningSession(session('a', { awaitingInput: true }))).toBe(true);
    expect(isRunningSession(session('b', { waitingFor: { waitId: 'w', sessionId: 'b', title: null } }))).toBe(true);
  });
});

describe('focusFolders', () => {
  const folders = [
    folder(1, [session('a'), session('b')]),
    folder(2, [session('c')]),
  ];

  test('all returns the list untouched', () => {
    expect(focusFolders(folders, { focus: 'all', statusOf: statusOf({}) })).toBe(folders);
  });

  test('running keeps only the rows that are running and drops empty workspaces', () => {
    const filtered = focusFolders(folders, {
      focus: 'running',
      statusOf: statusOf({ b: 'stream' }),
    });
    expect(filtered.map((f) => f.id)).toEqual([1]);
    expect(filtered[0].sessions.map((s) => s.id)).toEqual(['b']);
  });

  test('nothing running is an empty list, never the whole list', () => {
    expect(focusFolders(folders, { focus: 'running', statusOf: statusOf({}) })).toEqual([]);
  });
});

describe('runningSessionCount', () => {
  test('counts rows across every workspace', () => {
    const count = runningSessionCount(
      [
        folder(1, [session('a'), session('b')]),
        folder(2, [session('c', { awaitingInput: true })]),
      ],
      statusOf({ a: 'stream' }),
    );
    expect(count).toBe(2);
  });
});
