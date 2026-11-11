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
import type { AcpSpawnRequest } from '@/server/lib/harness/spawn.server';
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
  /** Every ACP spawn request, in order. */
  acpRequests: AcpSpawnRequest[];
  /** Rows `loadHarnessSession` answers with, keyed by Kabmo session id. */
  harnessSessions: Record<string, { harness: string; agentSessionId: string }>;
  /** Make the next spawn throw, to exercise the failure path. */
  failSpawnWith(error: Error | null): void;
  /** Whether the resumed session's file resolves. */
  setResumeFound(found: boolean): void;
  /** Hold `startScheduledRun` until the returned release is called. */
  holdStart(): () => void;
}

function makeHarness(): Harness {
  const runs: RunRecord[] = [];
  const sent: Record<string, Record<string, unknown>[]> = {};
  const acpRequests: AcpSpawnRequest[] = [];
  const harnessSessions: Record<string, { harness: string; agentSessionId: string }> = {};
  let spawnFailure: Error | null = null;
  let resumeFound = false;
  let runCounter = 0;
  let startGate: Promise<void> | null = null;
  let releaseStart: (() => void) | null = null;

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
    startAcpSession: async (request) => {
      if (spawnFailure) throw spawnFailure;
      acpRequests.push(request);
      return { session: makeSession(`acp-${request.harness}`), realSessionId: `acp-${request.harness}` };
    },
    loadHarnessSession: async (sessionId) => harnessSessions[sessionId] ?? null,
    loadPersistedAccessMode: async () => 'always-ask',
    claimDueTasks: async () => [],
    startScheduledRun: async (taskId) => {
      if (startGate) await startGate;
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
    acpRequests,
    harnessSessions,
    failSpawnWith: (error) => {
      spawnFailure = error;
    },
    setResumeFound: (found) => {
      resumeFound = found;
    },
    holdStart: () => {
      const gate = Promise.withResolvers<void>();
      startGate = gate.promise;
      releaseStart = gate.resolve;
      return () => {
        startGate = null;
        releaseStart?.();
        releaseStart = null;
      };
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
    harness: 'omp-rpc',
    timezone: 'UTC',
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

  test('a second manual run is refused while the first is in flight', async () => {
    const h = makeHarness();
    const release = h.holdStart();
    const first = runScheduledTask(task(), { manual: true, deps: h.deps });

    // The guard is set synchronously, before the first await.
    const second = await runScheduledTask(task(), { manual: true, deps: h.deps });
    expect(second).toBe('');
    expect(h.runs).toHaveLength(0);

    release();
    await first;
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].status).toBe('success');
  });

  test('an ACP task spawns on its harness and sends only the prompt', async () => {
    const h = makeHarness();
    const id = await runScheduledTask(
      task({
        harness: 'claude',
        model: { provider: 'anthropic', modelId: 'opus', thinkingLevel: 'high', accessMode: 'yolo' },
      }),
      { deps: h.deps },
    );

    expect(id).toBe('acp-claude');
    expect(h.acpRequests).toHaveLength(1);
    expect(h.acpRequests[0]).toMatchObject({
      harness: 'claude',
      cwd: '/work/proj',
      model: { provider: 'anthropic', modelId: 'opus' },
      thinkingLevel: 'high',
      accessMode: 'yolo',
    });
    // The handshake applied the picks; a second set_model would ask an agent
    // that may publish no such selector.
    expect(h.sent['acp-claude'].map((command) => command.type)).toEqual(['prompt']);
    expect(h.runs[0]).toMatchObject({ status: 'success', detail: 'new session' });
  });

  test('an ACP task resumes the agent session recorded for the same harness', async () => {
    const h = makeHarness();
    h.harnessSessions['sess-1'] = { harness: 'claude', agentSessionId: 'agent-1' };
    await runScheduledTask(task({ harness: 'claude', sessionId: 'sess-1' }), { deps: h.deps });

    expect(h.acpRequests[0].resumeAgentSessionId).toBe('agent-1');
    expect(h.runs[0].detail).toBe('resumed session');
  });

  test('an ACP task does not resume a session recorded for another harness', async () => {
    const h = makeHarness();
    h.harnessSessions['sess-1'] = { harness: 'codex', agentSessionId: 'agent-1' };
    await runScheduledTask(task({ harness: 'claude', sessionId: 'sess-1' }), { deps: h.deps });

    expect(h.acpRequests[0].resumeAgentSessionId).toBeUndefined();
    expect(h.runs[0].detail).toBe('session not found; started a new one');
  });
});
