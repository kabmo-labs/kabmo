/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a fire actually does: which omp child it drives, what it sends, and what
 * it records when the dispatch fails.
 *
 * The failure half is the point. A task is CLAIMED before it is dispatched, so
 * a dispatch that throws can never be retried by a later tick — the run record
 * is the only place the failure exists at all, and a `once` task is spent
 * whether or not its run worked. A test that only covered the happy path would
 * leave that silent.
 *
 * Every outside dependency is INJECTED (`ScheduleDeps`), never mocked through
 * `mock.module`: that swaps a registry entry for the whole `bun test` run, and
 * replacing the RPC manager here broke six unrelated suites with "Export named
 * … not found" (measured). Injection keeps the blast radius inside this file.
 */

import { describe, expect, test } from 'bun:test';
import { runScheduledTask, type ScheduleDeps, type ScheduleSessionHandle } from '@/server/lib/schedule/runtime.server';
import type { ScheduledTask } from '@/shared/types/schedule';

interface RunRecord {
  runId: string;
  taskId: string;
  status: string;
  detail: string;
  options: { sessionId?: string | null; countRun?: boolean };
}

interface Harness {
  deps: ScheduleDeps;
  runs: RunRecord[];
  /** Commands sent to each session, keyed by the session id it was opened for. */
  sent: Record<string, Record<string, unknown>[]>;
  /** Make the next spawn throw, to exercise the failure path. */
  failSpawnWith(error: Error | null): void;
  /** Whether the resumed session's file resolves. */
  setResumeFound(found: boolean): void;
}

function makeHarness(): Harness {
  const runs: RunRecord[] = [];
  const sent: Record<string, Record<string, unknown>[]> = {};
  let spawnFailure: Error | null = null;
  let resumeFound = false;
  let runCounter = 0;

  const makeSession = (key: string): ScheduleSessionHandle => ({
    send: async (command) => {
      sent[key] ??= [];
      sent[key].push(command);
      return {};
    },
  });

  const deps: ScheduleDeps = {
    startNewRpcSession: async (cwd) => {
      if (spawnFailure) throw spawnFailure;
      return { session: makeSession(cwd), realSessionId: `new-${cwd}` };
    },
    startRpcSession: async (sessionId) => ({ session: makeSession(sessionId), realSessionId: sessionId }),
    resolveSpawnCwd: async (recorded) => recorded ?? '/fallback',
    resolveSessionPathOr404: async (sessionId) =>
      resumeFound
        ? { filePath: `/sessions/${sessionId}.jsonl`, recordedCwd: '/work/other' }
        : { response: new Response('{"error":"Session not found"}', { status: 404 }) },
    loadPersistedAccessMode: async () => 'always-ask',
    claimDueTasks: async () => [],
    startScheduledRun: async (taskId) => {
      const id = `run-${runCounter++}`;
      runs.push({ runId: id, taskId, status: 'running', detail: '', options: {} });
      return id;
    },
    finishScheduledRun: async (runId, taskId, status, detail, options = {}) => {
      const record = runs.find((entry) => entry.runId === runId);
      if (record) Object.assign(record, { taskId, status, detail, options });
    },
  };

  return {
    deps,
    runs,
    sent,
    failSpawnWith: (error) => {
      spawnFailure = error;
    },
    setResumeFound: (found) => {
      resumeFound = found;
    },
  };
}

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: '',
    prompt: 'do the thing',
    kind: 'every',
    spec: '1h',
    folderId: null,
    cwd: '/work/proj',
    sessionId: null,
    model: null,
    enabled: true,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('runScheduledTask', () => {
  test('a fresh task spawns a new session and sends the prompt', async () => {
    const h = makeHarness();
    const id = await runScheduledTask(task(), { deps: h.deps });

    expect(id).toBe('new-/work/proj');
    expect(h.sent['/work/proj'].map((c) => c.type)).toEqual(['prompt']);
    expect(h.sent['/work/proj'][0].message).toBe('do the thing');
    expect(h.runs[0]).toMatchObject({
      status: 'success',
      detail: 'new session',
      options: { sessionId: 'new-/work/proj', countRun: true },
    });
  });

  test('a model snapshot is applied before the prompt, in order', async () => {
    const h = makeHarness();
    await runScheduledTask(
      task({ model: { provider: 'kenari', modelId: 'deepseek-v4-pro', thinkingLevel: 'max', accessMode: 'yolo' } }),
      { deps: h.deps },
    );
    expect(h.sent['/work/proj'].map((c) => c.type)).toEqual(['set_model', 'set_thinking_level', 'prompt']);
  });

  test("an 'auto' thinking level is not sent, so omp keeps its resolved level", async () => {
    const h = makeHarness();
    await runScheduledTask(
      task({ model: { provider: 'kenari', modelId: 'm', thinkingLevel: 'auto', accessMode: 'always-ask' } }),
      { deps: h.deps },
    );
    expect(h.sent['/work/proj'].map((c) => c.type)).toEqual(['set_model', 'prompt']);
  });

  test('a task with a sessionId resumes that session instead of starting one', async () => {
    const h = makeHarness();
    h.setResumeFound(true);
    const id = await runScheduledTask(task({ sessionId: 'sess-42' }), { deps: h.deps });

    expect(id).toBe('sess-42');
    expect(h.sent['sess-42'].map((c) => c.type)).toEqual(['prompt']);
    expect(h.runs[0]).toMatchObject({ status: 'success', detail: 'resumed session' });
  });

  test('a session id whose file is gone falls back to a new session, and says so', async () => {
    const h = makeHarness();
    h.setResumeFound(false);
    const id = await runScheduledTask(task({ sessionId: 'missing' }), { deps: h.deps });

    expect(id).toBe('new-/work/proj');
    expect(h.runs[0].detail).toBe('session not found; started a new one');
  });

  test('a failed dispatch records the error, and still counts as a fire', async () => {
    const h = makeHarness();
    h.failSpawnWith(new Error('spawn failed: ENOENT'));
    const id = await runScheduledTask(task(), { deps: h.deps });

    expect(id).toBe('');
    expect(h.runs[0]).toMatchObject({ status: 'error', detail: 'spawn failed: ENOENT', options: { countRun: true } });
  });

  test('a manual run is recorded without counting as a scheduled fire', async () => {
    const h = makeHarness();
    await runScheduledTask(task(), { manual: true, deps: h.deps });

    expect(h.runs[0]).toMatchObject({
      status: 'success',
      detail: 'Ran now (new session)',
      options: { countRun: false },
    });
  });
});
