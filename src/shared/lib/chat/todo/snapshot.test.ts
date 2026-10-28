/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { latestTodoSnapshot, todoProgress } from '@/shared/lib/chat/todo/snapshot';
import type { TodoPhase, TodoStatus } from '@/shared/types/todo';

/**
 * The reader has to match oh-my-pi's own branch rehydration, and every rule it
 * implements was verified against a real session written by omp 18.3.0:
 *
 *   - a `todo` toolResult carries `message.details.phases`;
 *   - `op:"view"` results carry phases but commit nothing (omp skips them);
 *   - a `user_todo_edit` custom entry carries `data.phases` and is durable;
 *   - the list is read off the ACTIVE BRANCH (leaf → root via `parentId`), so a
 *     rewound fork must not resurface.
 *
 * The failure mode of getting any of these wrong is a panel that quietly shows
 * a stale plan, which no other surface would contradict.
 */

const phases = (...tasks: Array<[string, TodoStatus]>): TodoPhase[] => [
  { name: 'Phase', tasks: tasks.map(([content, status]) => ({ content, status })) },
];

function entry(id: string, parentId: string | null, body: Record<string, unknown>) {
  return { id, parentId, timestamp: '2026-09-25T00:00:00.000Z', ...body };
}

function todoResult(id: string, parentId: string | null, details: Record<string, unknown>) {
  return entry(id, parentId, {
    type: 'message',
    message: { role: 'toolResult', toolName: 'todo', content: [{ type: 'text', text: '' }], details },
  });
}

describe('latestTodoSnapshot', () => {
  test('reads the deepest committed snapshot on the active branch', () => {
    const entries = [
      todoResult('a1', null, { op: 'init', phases: phases(['one', 'pending'], ['two', 'pending']) }),
      todoResult('a2', 'a1', { op: 'done', phases: phases(['one', 'completed'], ['two', 'in_progress']) }),
    ];

    const snapshot = latestTodoSnapshot(entries);

    expect(snapshot?.sourceEntryId).toBe('a2');
    expect(snapshot?.source).toBe('toolResult');
    expect(snapshot?.op).toBe('done');
    expect(snapshot?.phases[0].tasks[0].status).toBe('completed');
  });

  test('skips a `view` result — it reports the list without committing it', () => {
    const entries = [
      todoResult('a1', null, { op: 'init', phases: phases(['one', 'completed']) }),
      // A view result can be arbitrarily stale (it is echoed, not committed).
      todoResult('a2', 'a1', { op: 'view', phases: phases(['one', 'pending']) }),
    ];

    expect(latestTodoSnapshot(entries)?.sourceEntryId).toBe('a1');
  });

  test('skips an errored result', () => {
    const entries = [
      todoResult('a1', null, { op: 'init', phases: phases(['one', 'pending']) }),
      {
        ...todoResult('a2', 'a1', { op: 'done', phases: phases(['one', 'completed']) }),
        message: {
          role: 'toolResult',
          toolName: 'todo',
          isError: true,
          details: { op: 'done', phases: phases(['one', 'completed']) },
        },
      },
    ];

    expect(latestTodoSnapshot(entries)?.sourceEntryId).toBe('a1');
  });

  test('a `user_todo_edit` custom entry outranks an older tool result', () => {
    const entries = [
      todoResult('a1', null, { op: 'init', phases: phases(['one', 'pending']) }),
      entry('a2', 'a1', {
        type: 'custom',
        customType: 'user_todo_edit',
        data: { phases: phases(['one', 'abandoned']) },
      }),
    ];

    const snapshot = latestTodoSnapshot(entries);

    expect(snapshot?.source).toBe('custom');
    expect(snapshot?.phases[0].tasks[0].status).toBe('abandoned');
  });

  test('a snapshot on an abandoned branch is ignored (rewind)', () => {
    // a2 was rewound past: the leaf is b2, whose parent chain never reaches a2.
    const entries = [
      todoResult('a1', null, { op: 'init', phases: phases(['old', 'in_progress']) }),
      todoResult('a2', 'a1', { op: 'done', phases: phases(['old', 'completed']) }),
      todoResult('b1', 'a1', { op: 'append', phases: phases(['new', 'pending']) }),
      todoResult('b2', 'b1', { op: 'start', phases: phases(['new', 'in_progress']) }),
    ];

    const snapshot = latestTodoSnapshot(entries);

    expect(snapshot?.sourceEntryId).toBe('b2');
    expect(snapshot?.phases[0].tasks[0].content).toBe('new');
  });

  test('returns null when the transcript holds no todo state', () => {
    const entries = [
      entry('a1', null, { type: 'message', message: { role: 'user', content: 'hello' } }),
      todoResult('a2', 'a1', { op: 'view', phases: phases(['one', 'pending']) }),
    ];

    expect(latestTodoSnapshot(entries)).toBeNull();
  });

  test('rejects a malformed snapshot rather than rendering a half list', () => {
    const entries = [
      todoResult('a1', null, { op: 'init', phases: [{ name: 'Phase', tasks: [{ content: 'x', status: 'nonsense' }] }] }),
    ];

    expect(latestTodoSnapshot(entries)).toBeNull();
  });

  test('carries storage and timestamp when the entry records them', () => {
    const entries = [todoResult('a1', null, { op: 'init', phases: phases(['one', 'pending']), storage: 'memory' })];

    const snapshot = latestTodoSnapshot(entries);

    expect(snapshot?.storage).toBe('memory');
    expect(snapshot?.updatedAt).toBe('2026-09-25T00:00:00.000Z');
  });
});

describe('todoProgress', () => {
  test('counts closed as completed plus abandoned', () => {
    const progress = todoProgress(
      phases(['a', 'completed'], ['b', 'abandoned'], ['c', 'in_progress'], ['d', 'blocked'], ['e', 'pending']),
    );

    expect(progress).toEqual({
      total: 5,
      completed: 1,
      closed: 2,
      inProgress: 1,
      pending: 1,
      blocked: 1,
      abandoned: 1,
    });
  });
});
