/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat timeline's `todo` tool card parser.
 *
 * Two shapes are pinned here because both were measured wrong in real sessions:
 *
 *   1. A model that sends omp's init list under the WRONG key (`items` instead
 *      of `list`) gets each nested `{phase, items}` object stringified into a
 *      task's content by the runtime — omp stores that, and its own HUD reads
 *      the blob back. The card must draw the phase it names, not the JSON.
 *      Verified against the recorded call in
 *      `2026-09-28T03-39-57-670Z_01a0e619…jsonl` (5 blobs, one per phase).
 *   2. The status vocabulary is omp's five. `(dropped)` and `(blocked: …)`
 *      appear in the summary text and must not read as pending — 21 and 2
 *      results respectively across the author's 828 recorded `todo` calls.
 */

import { describe, expect, test } from 'bun:test';

import { parseTodoData } from '@/shared/lib/chat/todo/parser';
import type { ToolCallData } from '@/shared/types';

function todoTool(over: Partial<ToolCallData>): ToolCallData {
  return { id: 'c1', type: 'todo', name: 'todo', title: 'todo', ...over };
}

/** omp's summary for the malformed init: one line per intended phase, as JSON. */
const NESTED_INIT_OUTPUT = [
  'Remaining items (2):',
  '  - {"phase":"Fondasi auth server","items":["paths.ts: getAuthPath()","auth/config.ts: hash"]} [in_progress] (Tasks)',
  '  - {"phase":"Wiring server","items":["routes/auth/*: state, login, logout"]} [pending] (Tasks)',
  'Overall: 0/2 done, 2 open.',
  'Active phase 1/1 "Tasks" (0/2).',
  '  Tasks:',
  '    - [ ] {"phase":"Fondasi auth server","items":["paths.ts: getAuthPath()","auth/config.ts: hash"]} (in progress)',
  '    - [ ] {"phase":"Wiring server","items":["routes/auth/*: state, login, logout"]}',
].join('\n');

describe('parseTodoData — nested init-list recorded as task content', () => {
  const parsed = parseTodoData(
    todoTool({
      input: {
        op: 'init',
        items: [
          { phase: 'Fondasi auth server', items: ['paths.ts: getAuthPath()', 'auth/config.ts: hash'] },
          { phase: 'Wiring server', items: ['routes/auth/*: state, login, logout'] },
        ],
      },
      output: NESTED_INIT_OUTPUT,
      status: 'success',
    }),
  );

  test('labels each task with the phase it encodes, never the raw JSON', () => {
    const labels = parsed.groups.flatMap((g) => g.tasks.map((t) => t.content));
    expect(labels).toEqual(['Fondasi auth server', 'Wiring server']);
  });

  test('keeps the encoded items so nothing is lost', () => {
    const first = parsed.groups[0].tasks[0];
    expect(first.notes).toEqual(['paths.ts: getAuthPath()', 'auth/config.ts: hash']);
  });

  test('reads the status from the annotation beside the blob', () => {
    const statuses = parsed.groups.flatMap((g) => g.tasks.map((t) => t.status));
    expect(statuses).toEqual(['in_progress', 'pending']);
  });

  test('reports progress over the intended phases, not the blobs', () => {
    expect(parsed.progress.total).toBe(2);
    expect(parsed.progress.inProgress).toBe(1);
  });

  test('names the completed phase in the done badge, not the blob', () => {
    const done = parseTodoData(
      todoTool({
        input: {
          op: 'done',
          task: '{"phase":"Fondasi auth server","items":["paths.ts: getAuthPath()"]}',
        },
        output: [
          'Overall: 1/2 done, 1 open.',
          '  Tasks:',
          '    - [X] {"phase":"Fondasi auth server","items":["paths.ts: getAuthPath()"]}',
          '    - [ ] {"phase":"Wiring server","items":["routes/auth/*: state, login, logout"]} (in progress)',
        ].join('\n'),
        status: 'success',
      }),
    );

    expect(done.opBadge).toBe('Completed: Fondasi auth server');
    // The done task is matched by its LABEL, so the blob's own line still lands.
    expect(done.groups[0].tasks[0].status).toBe('completed');
  });
});

describe('parseTodoData — omp status vocabulary', () => {
  test('counts abandoned as closed and blocked as open, with the blocker note', () => {
    const parsed = parseTodoData(
      todoTool({
        input: { op: 'view' },
        output: [
          'Remaining items (2):',
          '  - ship the release [in_progress] (Work)',
          '  - needs a credential [blocked] (Work)',
          'Overall: 2/4 done, 2 open, 1 blocked.',
          'Active phase 1/1 "Work" (2/4).',
          '  Work:',
          '    - [X] write the code',
          '    - [X] review the diff',
          '    - [ ] ship the release (in progress)',
          '    - [ ] needs a credential (blocked: no API key)',
        ].join('\n'),
        status: 'success',
      }),
    );

    const byContent = new Map(parsed.groups[0].tasks.map((t) => [t.content, t]));
    expect(byContent.get('needs a credential')?.status).toBe('blocked');
    expect(byContent.get('needs a credential')?.blocker).toBe('no API key');
    expect(parsed.progress).toMatchObject({ total: 4, completed: 2, closed: 2, blocked: 1, inProgress: 1 });
    // `blocked` is NOT closed: a blocked task is still open work.
    expect(parsed.progress.closed).toBe(2);
  });

  test('treats (dropped) as abandoned rather than pending', () => {
    const parsed = parseTodoData(
      todoTool({
        input: { op: 'drop', task: 'old plan' },
        output: [
          'Overall: 1/1 done, 0 open.',
          '  Tasks:',
          '    - [ ] old plan (dropped)',
        ].join('\n'),
        status: 'success',
      }),
    );

    expect(parsed.groups[0].tasks[0].status).toBe('abandoned');
    expect(parsed.progress.closed).toBe(1);
  });

  test('leaves prose that merely mentions JSON alone', () => {
    const parsed = parseTodoData(
      todoTool({
        input: { op: 'init', list: [{ phase: 'Tasks', items: ['Add {phase, items} parsing'] }] },
        output: [
          'Remaining items (1):',
          '  - Add {phase, items} parsing [pending] (Tasks)',
          'Overall: 0/1 done, 1 open.',
          '  Tasks:',
          '    - [ ] Add {phase, items} parsing',
        ].join('\n'),
        status: 'success',
      }),
    );

    expect(parsed.groups[0].tasks[0].content).toBe('Add {phase, items} parsing');
    expect(parsed.groups[0].tasks[0].notes).toBeUndefined();
  });
});
