/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The todo panel's presentation table and lookups.
 *
 * `todoStatusVisual` is a five-way table whose failure mode is silent: a
 * `blocked` or `abandoned` row drawn with the pending style still looks
 * plausible, so every status is pinned explicitly — including that `blocked`
 * is NOT closed while `abandoned` IS. `closedTaskCount`/`todoProgressPercent`
 * count closed = completed + abandoned (omp's own HUD rule); pinning that stops
 * a later "completed only" refactor from making a list read as permanently
 * stuck. `currentTaskLocation` is deliberately two-pass — an in-progress task
 * anywhere beats an earlier pending one — which is the difference between the
 * panel highlighting the live task and a stale one.
 *
 * `parseNestedPhaseEntry` handles the real transcript shape where a model sends
 * `items:[{phase,items}]`, so a whole init-list entry lands in a task's content
 * as JSON. The strictness (the WHOLE string must be the object, string phase,
 * non-empty string items) is what keeps a prose task that merely mentions JSON
 * from being drawn as a phase.
 */

import { describe, expect, test } from 'bun:test';

import {
  closedTaskCount,
  currentTaskLocation,
  taskNote,
  todoProgressLabel,
  todoProgressPercent,
  todoStatusVisual,
} from '@/shared/lib/chat/todo/progress';
import { parseNestedPhaseEntry, stripTrailingStatusNote } from '@/shared/lib/chat/todo/nested-phase';
import type { TodoItem, TodoPhase, TodoProgress, TodoStatus } from '@/shared/types/todo';

const progress = (partial: Partial<TodoProgress>): TodoProgress => ({
  total: 0,
  completed: 0,
  closed: 0,
  inProgress: 0,
  pending: 0,
  blocked: 0,
  abandoned: 0,
  ...partial,
});

const phase = (name: string, tasks: Array<[string, TodoStatus]>): TodoPhase => ({
  name,
  tasks: tasks.map(([content, status]) => ({ content, status })),
});

const task = (status: TodoStatus, extra: Partial<TodoItem> = {}): TodoItem => ({
  content: 'task',
  status,
  ...extra,
});

describe('todoStatusVisual', () => {
  test('maps every status to its label, tone and flags', () => {
    expect(todoStatusVisual('pending')).toEqual({
      label: 'Pending',
      tone: 'text-ink/45',
      active: false,
      closed: false,
    });
    expect(todoStatusVisual('in_progress')).toEqual({
      label: 'In progress',
      tone: 'text-ink',
      active: true,
      closed: false,
    });
    expect(todoStatusVisual('completed')).toEqual({
      label: 'Completed',
      tone: 'text-success',
      active: false,
      closed: true,
    });
    expect(todoStatusVisual('abandoned')).toEqual({
      label: 'Abandoned',
      tone: 'text-error/70',
      active: false,
      closed: true,
    });
  });

  test('a blocked task is warned about but not closed and not active', () => {
    expect(todoStatusVisual('blocked')).toEqual({
      label: 'Blocked',
      tone: 'text-warning',
      active: false,
      closed: false,
    });
  });

  test('an unknown status degrades to the pending visual', () => {
    expect(todoStatusVisual('nope' as TodoStatus)).toEqual(todoStatusVisual('pending'));
  });
});

describe('todoProgressLabel', () => {
  test('reports an empty list instead of a 0/0 fraction', () => {
    expect(todoProgressLabel(progress({}))).toBe('No tasks');
  });

  test('shows the closed fraction with no suffixes when nothing is live', () => {
    expect(todoProgressLabel(progress({ total: 4, closed: 4, completed: 4 }))).toBe('4/4 done');
  });

  test('appends in-progress, blocked and abandoned counts in that order', () => {
    const label = todoProgressLabel(
      progress({ total: 11, closed: 4, completed: 3, inProgress: 1, blocked: 2, abandoned: 1 }),
    );
    expect(label).toBe('4/11 done · 1 in progress · 2 blocked · 1 abandoned');
  });

  test('omits zero-count suffixes', () => {
    expect(todoProgressLabel(progress({ total: 2, closed: 1, inProgress: 1 }))).toBe('1/2 done · 1 in progress');
  });
});

describe('todoProgressPercent', () => {
  test('is 0 for an empty list rather than NaN', () => {
    expect(todoProgressPercent(progress({}))).toBe(0);
  });

  test('rounds to the nearest whole percent', () => {
    expect(todoProgressPercent(progress({ total: 4, closed: 2 }))).toBe(50);
    expect(todoProgressPercent(progress({ total: 3, closed: 1 }))).toBe(33);
    expect(todoProgressPercent(progress({ total: 3, closed: 2 }))).toBe(67);
  });

  test('counts abandoned tasks as closed progress', () => {
    expect(todoProgressPercent(progress({ total: 2, closed: 1, abandoned: 1 }))).toBe(50);
  });
});

describe('currentTaskLocation', () => {
  test('an in-progress task in a later phase beats an earlier pending one', () => {
    const phases = [phase('A', [['a', 'pending']]), phase('B', [['b', 'in_progress']])];
    expect(currentTaskLocation(phases)).toEqual({ phase: 1, task: 0 });
  });

  test('falls back to the first pending task when nothing is in progress', () => {
    const phases = [phase('A', [['a', 'completed']]), phase('B', [['b', 'pending'], ['c', 'pending']])];
    expect(currentTaskLocation(phases)).toEqual({ phase: 1, task: 0 });
  });

  test('picks the first in-progress task when several are live', () => {
    const phases = [phase('A', [['a', 'in_progress'], ['b', 'in_progress']])];
    expect(currentTaskLocation(phases)).toEqual({ phase: 0, task: 0 });
  });

  test('returns null when every task is settled', () => {
    expect(currentTaskLocation([phase('A', [['a', 'completed'], ['b', 'abandoned']])])).toBeNull();
  });

  test('a blocked task is not a pending fallback', () => {
    expect(currentTaskLocation([phase('A', [['a', 'blocked']])])).toBeNull();
  });

  test('handles empty phase lists and empty phases', () => {
    expect(currentTaskLocation([])).toBeNull();
    expect(currentTaskLocation([phase('A', []), phase('B', [])])).toBeNull();
  });
});

describe('closedTaskCount', () => {
  test('counts completed and abandoned, ignoring the other three states', () => {
    const p = phase('A', [
      ['a', 'completed'],
      ['b', 'abandoned'],
      ['c', 'pending'],
      ['d', 'in_progress'],
      ['e', 'blocked'],
    ]);
    expect(closedTaskCount(p)).toBe(2);
  });

  test('is 0 when nothing is settled', () => {
    expect(closedTaskCount(phase('A', []))).toBe(0);
    expect(closedTaskCount(phase('A', [['a', 'pending']]))).toBe(0);
  });
});

describe('taskNote', () => {
  test('prefers a trimmed blocker over the details', () => {
    expect(taskNote(task('blocked', { blocker: '  waiting on API  ', details: 'ignored' }))).toBe('waiting on API');
  });

  test('falls back to trimmed details when the blocker is blank', () => {
    expect(taskNote(task('blocked', { blocker: '   ', details: '  see RFC  ' }))).toBe('see RFC');
    expect(taskNote(task('pending', { blocker: '', details: 'detail' }))).toBe('detail');
  });

  test('returns undefined when there is nothing to show', () => {
    expect(taskNote(task('pending'))).toBeUndefined();
    expect(taskNote(task('pending', { blocker: '  ', details: '  ' }))).toBeUndefined();
  });
});

describe('parseNestedPhaseEntry', () => {
  test('reads a whole JSON init-list entry out of a task content', () => {
    expect(parseNestedPhaseEntry('{"phase":"Fondasi","items":["a","b"]}')).toEqual({
      phase: 'Fondasi',
      items: ['a', 'b'],
    });
  });

  test('tolerates surrounding whitespace and trims the phase name', () => {
    expect(parseNestedPhaseEntry('  { "phase": "  P  ", "items": ["x"] }  ')).toEqual({ phase: 'P', items: ['x'] });
  });

  test('ignores extra keys', () => {
    expect(parseNestedPhaseEntry('{"phase":"P","items":["x"],"extra":1}')).toEqual({ phase: 'P', items: ['x'] });
  });

  test('rejects prose and non-object JSON', () => {
    expect(parseNestedPhaseEntry('just a task')).toBeUndefined();
    expect(parseNestedPhaseEntry('[]')).toBeUndefined();
    expect(parseNestedPhaseEntry('null')).toBeUndefined();
    expect(parseNestedPhaseEntry('"a string"')).toBeUndefined();
    expect(parseNestedPhaseEntry('42')).toBeUndefined();
    expect(parseNestedPhaseEntry('{not json}')).toBeUndefined();
  });

  test('rejects a missing/blank phase or a non-array/empty/non-string items list', () => {
    expect(parseNestedPhaseEntry('{"a":1}')).toBeUndefined();
    expect(parseNestedPhaseEntry('{"phase":1,"items":["a"]}')).toBeUndefined();
    expect(parseNestedPhaseEntry('{"phase":"   ","items":["a"]}')).toBeUndefined();
    expect(parseNestedPhaseEntry('{"phase":"P","items":"x"}')).toBeUndefined();
    expect(parseNestedPhaseEntry('{"phase":"P","items":[]}')).toBeUndefined();
    expect(parseNestedPhaseEntry('{"phase":"P","items":["a",1]}')).toBeUndefined();
  });
});

describe('stripTrailingStatusNote', () => {
  test('removes the three trailing status annotations', () => {
    expect(stripTrailingStatusNote('Write the tests (in progress)')).toBe('Write the tests');
    expect(stripTrailingStatusNote('Write the tests (dropped)')).toBe('Write the tests');
    expect(stripTrailingStatusNote('Write the tests (blocked)')).toBe('Write the tests');
    expect(stripTrailingStatusNote('Write the tests (blocked: waiting on review)')).toBe('Write the tests');
  });

  test('is case-insensitive and trims the remainder', () => {
    expect(stripTrailingStatusNote('Do it (IN PROGRESS)   ')).toBe('Do it');
    expect(stripTrailingStatusNote('Do it (Dropped)')).toBe('Do it');
  });

  test('leaves text with no trailing note untouched', () => {
    expect(stripTrailingStatusNote('Write the tests')).toBe('Write the tests');
    expect(stripTrailingStatusNote('a (in progress) b')).toBe('a (in progress) b');
    expect(stripTrailingStatusNote('x (blocked: a (b))')).toBe('x (blocked: a (b))');
  });

  test('recovers a JSON content from behind the annotation', () => {
    expect(stripTrailingStatusNote('{"phase":"P","items":["a"]} (in progress)')).toBe('{"phase":"P","items":["a"]}');
  });

  test('handles the empty string', () => {
    expect(stripTrailingStatusNote('')).toBe('');
  });
});
