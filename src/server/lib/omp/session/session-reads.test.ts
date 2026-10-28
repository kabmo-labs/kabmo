/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session-transcript reads: the todo snapshot the panel polls, the raw
 * messages page, and the shared JSONL scan cache behind them.
 *
 * All three read a file the agent is concurrently appending to, so the pinned
 * properties are the ones a hand-written fixture can still prove:
 * - `readSessionTodos` locates a session by id, takes the deepest committed
 *   snapshot on the ACTIVE BRANCH (leaf → root), skips `op:"view"` and errored
 *   results, and answers an empty state — never a throw — for a missing file;
 * - `computeRawMessagesPage` counts every user/assistant message for `total`
 *   but only role matches for `filteredTotal`, and slices newest-first pages
 *   with out-of-range pages returning an empty list;
 * - `loadSessionEntries`/`scanSessionEntries` parse once per file version,
 *   skip torn lines, and honour a `false` return as an early stop.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { readSessionTodos } from '@/server/lib/omp/session/todos';
import { computeRawMessagesPage } from '@/server/lib/omp/session/telemetry-raw';
import { loadSessionEntries, scanSessionEntries } from '@/server/lib/omp/session/telemetry/scan';

const originalAgentDir = Bun.env.PI_CODING_AGENT_DIR;
const originalXdg = Bun.env.XDG_DATA_HOME;
const roots: string[] = [];
let sessionsRoot = '';

beforeAll(async () => {
  const root = await fs.promises.mkdtemp(join(tmpdir(), 'omp-session-'));
  roots.push(root);
  const agent = join(root, 'agent');
  sessionsRoot = join(agent, 'sessions');
  await fs.promises.mkdir(sessionsRoot, { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = agent;
  // XDG would redirect the sessions dir to $XDG_DATA_HOME/omp when it exists.
  delete Bun.env.XDG_DATA_HOME;
});

afterAll(async () => {
  if (originalAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalXdg === undefined) delete Bun.env.XDG_DATA_HOME;
  else Bun.env.XDG_DATA_HOME = originalXdg;
  for (const root of roots) await fs.promises.rm(root, { recursive: true, force: true });
});

/** Write a session file under the sessions root and return its path. */
async function writeSession(id: string, entries: Array<Record<string, unknown>>): Promise<string> {
  const dir = join(sessionsRoot, 'project');
  await fs.promises.mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  const lines = [
    JSON.stringify({ type: 'session', id, cwd: '/work', timestamp: '2026-09-25T00:00:00.000Z' }),
    ...entries.map((entry) => JSON.stringify(entry)),
  ];
  await Bun.write(path, `${lines.join('\n')}\n`);
  return path;
}

const phase = (tasks: Array<[string, string]>) => [
  { name: 'Phase', tasks: tasks.map(([content, status]) => ({ content, status })) },
];

const todoResult = (id: string, parentId: string | null, details: Record<string, unknown>) => ({
  id,
  parentId,
  timestamp: '2026-09-25T00:00:01.000Z',
  type: 'message',
  message: { role: 'toolResult', toolName: 'todo', content: [], details },
});

describe('readSessionTodos', () => {
  test('an unknown session id answers the empty state, not a throw', async () => {
    expect(await readSessionTodos('no-such-session')).toEqual({
      snapshot: null,
      progress: { total: 0, completed: 0, closed: 0, inProgress: 0, pending: 0, blocked: 0, abandoned: 0 },
    });
  });

  test('a session with no todo entry answers the empty state', async () => {
    await writeSession('sess-no-todos', [{ id: 'm1', parentId: null, type: 'message', message: { role: 'user', content: 'hi' } }]);
    const state = await readSessionTodos('sess-no-todos');
    expect(state.snapshot).toBeNull();
    expect(state.progress.total).toBe(0);
  });

  test('reads the deepest committed snapshot and rolls up its progress', async () => {
    await writeSession('sess-todos-1', [
      todoResult('t1', null, { op: 'init', phases: phase([['one', 'pending'], ['two', 'pending']]) }),
      todoResult('t2', 't1', { op: 'done', phases: phase([['one', 'completed'], ['two', 'in_progress']]) }),
      { id: 'u1', parentId: 't2', type: 'message', message: { role: 'user', content: 'go on' } },
    ]);

    const state = await readSessionTodos('sess-todos-1');
    expect(state.snapshot?.sourceEntryId).toBe('t2');
    expect(state.snapshot?.source).toBe('toolResult');
    expect(state.snapshot?.op).toBe('done');
    expect(state.snapshot?.updatedAt).toBe('2026-09-25T00:00:01.000Z');
    expect(state.progress).toEqual({
      total: 2,
      completed: 1,
      closed: 1,
      inProgress: 1,
      pending: 0,
      blocked: 0,
      abandoned: 0,
    });
  });

  test('a newer view-only result is skipped and a newer errored one too', async () => {
    await writeSession('sess-todos-2', [
      todoResult('t1', null, { op: 'init', phases: phase([['one', 'completed']]) }),
      // A view echoes the list without committing it.
      todoResult('t2', 't1', { op: 'view', phases: phase([['one', 'pending']]) }),
      {
        ...todoResult('t3', 't2', { op: 'done', phases: phase([['one', 'abandoned']]) }),
        message: { role: 'toolResult', toolName: 'todo', isError: true, details: { op: 'done', phases: phase([['one', 'abandoned']]) } },
      },
    ]);

    const state = await readSessionTodos('sess-todos-2');
    expect(state.snapshot?.sourceEntryId).toBe('t1');
    expect(state.snapshot?.phases[0].tasks[0].status).toBe('completed');
  });

  test('a rewound fork is ignored: only the leaf→root branch counts', async () => {
    await writeSession('sess-todos-3', [
      todoResult('t1', null, { op: 'init', phases: phase([['old', 'pending']]) }),
      // A fork that was rewound away — it is newer in file order but off-branch.
      todoResult('fork', 't1', { op: 'done', phases: phase([['forked', 'completed']]) }),
      todoResult('t2', 't1', { op: 'start', phases: phase([['old', 'in_progress']]) }),
      { id: 'leaf', parentId: 't2', type: 'message', message: { role: 'user', content: 'continue' } },
    ]);

    const state = await readSessionTodos('sess-todos-3');
    expect(state.snapshot?.sourceEntryId).toBe('t2');
    expect(state.snapshot?.phases[0].tasks[0].content).toBe('old');
  });

  test('a user_todo_edit custom entry is a committed snapshot', async () => {
    await writeSession('sess-todos-4', [
      todoResult('t1', null, { op: 'init', phases: phase([['one', 'pending']]) }),
      {
        id: 'c1',
        parentId: 't1',
        timestamp: '2026-09-25T00:00:02.000Z',
        type: 'custom',
        customType: 'user_todo_edit',
        data: { phases: phase([['one', 'blocked']]) },
      },
    ]);

    const state = await readSessionTodos('sess-todos-4');
    expect(state.snapshot?.sourceEntryId).toBe('c1');
    expect(state.snapshot?.source).toBe('custom');
    expect(state.progress.blocked).toBe(1);
  });

  test('a rewritten transcript is re-read rather than served from cache', async () => {
    const path = await writeSession('sess-todos-5', [
      todoResult('t1', null, { op: 'init', phases: phase([['one', 'pending']]) }),
    ]);
    expect((await readSessionTodos('sess-todos-5')).snapshot?.sourceEntryId).toBe('t1');

    // Same id, different content (and a different size, so the size key moves).
    await Bun.write(path, [
      JSON.stringify({ type: 'session', id: 'sess-todos-5', cwd: '/work', timestamp: '2026-09-25T00:00:00.000Z' }),
      JSON.stringify(todoResult('t1', null, { op: 'init', phases: phase([['one', 'pending']]) })),
      JSON.stringify(todoResult('t2', 't1', { op: 'done', phases: phase([['one', 'completed']]) })),
      '',
    ].join('\n'));

    expect((await readSessionTodos('sess-todos-5')).snapshot?.sourceEntryId).toBe('t2');
  });
});

describe('computeRawMessagesPage', () => {
  /** Five messages, oldest→newest: u1 a1 u2 a2 a3. */
  async function messageSession(id: string): Promise<string> {
    const message = (mid: string, parentId: string | null, role: string, content: string, usage?: Record<string, unknown>) => ({
      id: mid,
      parentId,
      timestamp: '2026-09-25T00:00:00.000Z',
      type: 'message',
      message: { role, content, ...(usage ? { usage } : {}) },
    });
    return writeSession(id, [
      message('u1', null, 'user', 'first question'),
      message('a1', 'u1', 'assistant', 'first answer'),
      message('u2', 'a1', 'user', 'second question'),
      message('a2', 'u2', 'assistant', 'second answer'),
      message('a3', 'a2', 'assistant', 'third answer', { input: 1200, output: 34, cost: { total: 0.02 } }),
    ]);
  }

  test('total counts every user/assistant row, filteredTotal only role matches', async () => {
    const path = await messageSession('raw-1');
    const all = await computeRawMessagesPage(path, 1, 10, 'all');
    expect(all.total).toBe(5);
    expect(all.filteredTotal).toBe(5);

    const users = await computeRawMessagesPage(path, 1, 10, 'user');
    expect(users.total).toBe(5);
    expect(users.filteredTotal).toBe(2);
    expect(users.items.map((i) => i.id)).toEqual(['u2', 'u1']);
  });

  test('pages are newest-first chunks of pageSize rows', async () => {
    const path = await messageSession('raw-2');
    const page1 = await computeRawMessagesPage(path, 1, 2, 'all');
    expect(page1.items.map((i) => i.id)).toEqual(['a3', 'a2']);

    const page2 = await computeRawMessagesPage(path, 2, 2, 'all');
    expect(page2.items.map((i) => i.id)).toEqual(['u2', 'a1']);

    const page3 = await computeRawMessagesPage(path, 3, 2, 'all');
    expect(page3.items.map((i) => i.id)).toEqual(['u1']);
  });

  test('an out-of-range page is an empty list with the totals intact', async () => {
    const path = await messageSession('raw-3');
    const page = await computeRawMessagesPage(path, 9, 2, 'all');
    expect(page).toEqual({ items: [], total: 5, filteredTotal: 5 });
  });

  test('an assistant item carries the type badge and token summary', async () => {
    const path = await messageSession('raw-4');
    const page = await computeRawMessagesPage(path, 1, 1, 'all');
    const item = page.items[0];
    expect(item.id).toBe('a3');
    expect(item.type).toBe('text');
    expect(item.badgeLabel).toBe('text');
    expect(item.tokenSummary).toBe('1,200 / 34');
    expect(item.info.role).toBe('assistant');
    if (!item.info.path) throw new Error('expected a session path in the info');
    expect(item.info.path.cwd).toBe('/work');
    expect(item.info.cost).toBe(0.02);
  });

  test('a user item is labelled with its snippet', async () => {
    const path = await messageSession('raw-5');
    const page = await computeRawMessagesPage(path, 1, 10, 'user');
    expect(page.items[0]).toEqual({
      id: 'u2',
      type: 'user',
      badgeLabel: 'user: second question',
      tokenSummary: '',
      timestamp: expect.any(String),
      info: expect.any(Object),
      rawPayload: expect.any(Object),
    });
  });
});

describe('session entry scan', () => {
  test('a missing file scans as empty and a torn line is skipped', async () => {
    expect(await loadSessionEntries(join(sessionsRoot, 'missing.jsonl'))).toEqual([]);

    const path = await writeSession('scan-1', []);
    await Bun.write(path, `${JSON.stringify({ type: 'session', id: 'scan-1' })}\n{not json\n${JSON.stringify({ type: 'message', id: 'm1' })}\n`);
    const entries = await loadSessionEntries(path);
    // The header entry keeps its own id; only the torn line is dropped.
    expect(entries.map((e) => e.id)).toEqual(['scan-1', 'm1']);
  });

  test('scanSessionEntries visits in order and stops when the visitor returns false', async () => {
    const path = await writeSession('scan-2', [
      { id: 'm1', type: 'message' },
      { id: 'm2', type: 'message' },
      { id: 'm3', type: 'message' },
    ]);
    const seen: Array<string | undefined> = [];
    await scanSessionEntries(path, (entry, index) => {
      seen.push(entry.id);
      if (index === 1) return false;
    });
    // Header, then m1 — the false return at index 1 ends the walk, so m2/m3
    // are never visited.
    expect(seen).toEqual(['scan-2', 'm1']);
  });

  test('a rewritten file is re-parsed instead of serving the cached entries', async () => {
    const path = await writeSession('scan-3', [{ id: 'm1', type: 'message' }]);
    expect((await loadSessionEntries(path)).map((e) => e.id)).toEqual(['scan-3', 'm1']);

    await Bun.write(path, `${JSON.stringify({ type: 'session', id: 'scan-3' })}\n${JSON.stringify({ id: 'm2', type: 'message' })}\n`);
    expect((await loadSessionEntries(path)).map((e) => e.id)).toEqual(['scan-3', 'm2']);
  });
});
