/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The subagent roster is stitched together from three different wire shapes —
 * a parent task toolResult, an `async-result` custom message, and a `hub`
 * `jobs` snapshot — and the recovery route reads a fourth from disk. Getting
 * the settlement fold wrong leaves a detached agent "started" forever; getting
 * the status projection wrong regresses a finished agent when a stale progress
 * frame arrives. These tests pin the status vocabulary, the fold precedence,
 * and the history → roster projection.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { asAgentSource, asNumber, asString, taskResultStructuredOutput, taskResultUsageCost } from '@/shared/lib/omp/subagent/result-details';
import { applySettlement, foldSettlements } from '@/shared/lib/omp/subagent/history/settlement';
import { progressStatusToHistory, progressUpsertBlocked, resultStatus } from '@/shared/lib/omp/subagent/history/status';
import {
  fetchSubagentHistory,
  formatSubagentCost,
  formatSubagentDuration,
  formatSubagentMeta,
  historyEntryToSubagentInfo,
} from '@/shared/lib/omp/subagent/history/client';
import type { OmpMessageEntry } from '@/shared/lib/omp/session/messages-parse';
import type { SubagentHistoryEntry } from '@/shared/types/omp/subagent';

/** A launched-but-unsettled roster row, the state every settlement folds onto. */
function seeded(overrides: Partial<SubagentHistoryEntry> = {}): SubagentHistoryEntry {
  return { id: 'job-1', agent: 'task', status: 'started', index: 0, transcriptAvailable: false, ...overrides };
}

function roster(...entries: SubagentHistoryEntry[]): Map<string, SubagentHistoryEntry> {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

describe('result-details guards', () => {
  test('asString rejects empty strings, non-strings and null', () => {
    expect(asString('x')).toBe('x');
    expect(asString('')).toBeUndefined();
    expect(asString(7)).toBeUndefined();
    expect(asString(null)).toBeUndefined();
    expect(asString(undefined)).toBeUndefined();
  });

  test('asNumber accepts finite numbers only', () => {
    expect(asNumber(0)).toBe(0);
    expect(asNumber(-1.5)).toBe(-1.5);
    expect(asNumber(Number.NaN)).toBeUndefined();
    expect(asNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(asNumber('3')).toBeUndefined();
  });

  test('asAgentSource accepts exactly the three documented sources', () => {
    expect(asAgentSource('bundled')).toBe('bundled');
    expect(asAgentSource('user')).toBe('user');
    expect(asAgentSource('project')).toBe('project');
    expect(asAgentSource('plugin')).toBeUndefined();
    expect(asAgentSource(undefined)).toBeUndefined();
  });
});

describe('taskResultUsageCost', () => {
  test('prefers the settled total', () => {
    expect(taskResultUsageCost({ cost: { total: 0.25, input: 9, output: 9 } })).toBe(0.25);
  });

  test('falls back to input + output when total is absent', () => {
    expect(taskResultUsageCost({ cost: { input: 0.01, output: 0.02 } })).toBeCloseTo(0.03, 10);
  });

  test('is undefined without a usable cost record', () => {
    expect(taskResultUsageCost(undefined)).toBeUndefined();
    expect(taskResultUsageCost({})).toBeUndefined();
    expect(taskResultUsageCost({ cost: 5 })).toBeUndefined();
    expect(taskResultUsageCost({ cost: { input: 1 } })).toBeUndefined();
    expect(taskResultUsageCost({ cost: { total: 'free' } })).toBeUndefined();
  });
});

describe('taskResultStructuredOutput', () => {
  test('projects only the documented UI fields', () => {
    // `data` is arbitrary upstream payload and must never reach the roster.
    const out = taskResultStructuredOutput({ source: 'task', mode: 'sync', status: 'ok', error: 'none', data: { secret: 1 } });
    expect(out).toEqual({ source: 'task', mode: 'sync', status: 'ok', error: 'none' });
    expect(Object.keys(out!)).not.toContain('data');
  });

  test('drops non-string fields and returns undefined when nothing survives', () => {
    expect(taskResultStructuredOutput({ source: 5, data: 1 })).toBeUndefined();
    expect(taskResultStructuredOutput('nope')).toBeUndefined();
    expect(taskResultStructuredOutput(undefined)).toBeUndefined();
  });
});

describe('status projection', () => {
  test('progressStatusToHistory maps the live vocabulary, defaulting to started', () => {
    expect(progressStatusToHistory('completed')).toBe('completed');
    expect(progressStatusToHistory('failed')).toBe('failed');
    expect(progressStatusToHistory('aborted')).toBe('aborted');
    expect(progressStatusToHistory('running')).toBe('started');
    expect(progressStatusToHistory(undefined)).toBe('started');
  });

  test('resultStatus reads the settled shape in precedence order', () => {
    expect(resultStatus({ status: 'completed' })).toBe('completed');
    expect(resultStatus({ status: 'failed' })).toBe('failed');
    expect(resultStatus({ status: 'aborted' })).toBe('aborted');
    expect(resultStatus({ aborted: true })).toBe('aborted');
    expect(resultStatus({ error: 'boom' })).toBe('failed');
    expect(resultStatus({ exitCode: 0 })).toBe('completed');
    expect(resultStatus({ exitCode: 3 })).toBe('failed');
    expect(resultStatus({})).toBe('started');
  });

  test('an explicit status wins over the aborted flag and exit code', () => {
    expect(resultStatus({ status: 'completed', aborted: true, exitCode: 1 })).toBe('completed');
    expect(resultStatus({ aborted: true, exitCode: 0 })).toBe('aborted');
  });

  test('an empty error string is not a failure', () => {
    expect(resultStatus({ error: '' })).toBe('started');
  });

  test('progressUpsertBlocked protects a settled row only', () => {
    expect(progressUpsertBlocked(seeded({ status: 'started' }))).toBe(false);
    expect(progressUpsertBlocked(seeded({ status: 'completed' }))).toBe(true);
    expect(progressUpsertBlocked(seeded({ status: 'failed' }))).toBe(true);
    expect(progressUpsertBlocked(seeded({ status: 'aborted' }))).toBe(true);
    expect(progressUpsertBlocked(seeded({ status: 'started', result: { exitCode: 0 } }))).toBe(true);
  });
});

describe('applySettlement', () => {
  test('an unknown id is ignored', () => {
    const byId = roster(seeded());
    applySettlement(byId, { id: 'ghost', status: 'completed' });
    expect(byId.has('ghost')).toBe(false);
    expect(byId.size).toBe(1);
  });

  test('merges the patch while preserving launch identity and prior text', () => {
    const byId = roster(seeded({ task: 'do the thing', batchSeq: 4, index: 2, parentToolCallId: 'call-1' }));
    applySettlement(byId, { id: 'job-1', status: 'completed', durationMs: 900, result: { exitCode: 0 } });
    expect(byId.get('job-1')).toMatchObject({
      status: 'completed',
      durationMs: 900,
      task: 'do the thing',
      index: 2,
      batchSeq: 4,
      parentToolCallId: 'call-1',
      result: { exitCode: 0 },
    });
  });

  test('a later settlement overwrites status and merges the result', () => {
    const byId = roster(seeded({ status: 'started', result: { outputPath: '/tmp/out' } }));
    applySettlement(byId, { id: 'job-1', status: 'failed', result: { exitCode: 1 } });
    expect(byId.get('job-1')!.status).toBe('failed');
    expect(byId.get('job-1')!.result).toEqual({ outputPath: '/tmp/out', exitCode: 1 });
  });
});

describe('foldSettlements — async-result custom messages', () => {
  const message = (details: unknown, content?: unknown): OmpMessageEntry => ({
    type: 'custom_message',
    customType: 'async-result',
    details,
    content,
  });

  test('a jobs snapshot settles a running entry', () => {
    const byId = roster(seeded());
    foldSettlements([message({ jobs: [{ jobId: 'job-1', status: 'completed', durationMs: 1200, resolvedModel: 'm-1' }] })], byId);
    expect(byId.get('job-1')).toMatchObject({
      status: 'completed',
      durationMs: 1200,
      resolvedModel: 'm-1',
      transcriptAvailable: false,
      result: { exitCode: 0 },
      agent: 'task',
    });
  });

  test('a job that still has no status is left untouched', () => {
    const byId = roster(seeded());
    foldSettlements([message({ jobs: [{ jobId: 'job-1', status: 'running' }] })], byId);
    expect(byId.get('job-1')!.status).toBe('started');
  });

  test('an inline completed result settles a status-less job', () => {
    const byId = roster(seeded());
    const content = '<task-result id="job-1" status="completed">done</task-result>';
    foldSettlements([message({ jobs: [{ jobId: 'job-1' }] }, content)], byId);
    expect(byId.get('job-1')!.status).toBe('completed');
  });

  test('the jobs array wins over the inline form, and `id` is a jobId fallback', () => {
    const byId = roster(seeded({ id: 'job-2' }));
    const content = '<task-result id="job-2" status="completed">done</task-result>';
    foldSettlements([message({ jobs: [{ id: 'job-2', status: 'failed' }] }, content)], byId);
    expect(byId.get('job-2')!.status).toBe('failed');
  });

  test('an inline form without a jobs array settles its own id', () => {
    const byId = roster(seeded({ id: 'inline-1' }));
    const content = '<task-result id="inline-1" status="aborted">stopped</task-result>';
    foldSettlements([message({}, content)], byId);
    expect(byId.get('inline-1')!.status).toBe('aborted');
  });

  test('an inline form naming an unknown agent changes nothing', () => {
    const byId = roster(seeded());
    foldSettlements([message({}, '<task-result id="other" status="completed">x</task-result>')], byId);
    expect(byId.get('job-1')!.status).toBe('started');
    expect(byId.size).toBe(1);
  });
});

describe('foldSettlements — hub jobs toolResults', () => {
  const hub = (jobs: unknown): OmpMessageEntry => ({
    type: 'message',
    message: { role: 'toolResult', toolName: 'hub', details: { jobs } },
  });

  test('a non-zero exit code settles the entry as failed', () => {
    const byId = roster(seeded());
    foldSettlements([hub([{ id: 'job-1', exitCode: 1, durationMs: 50 }])], byId);
    expect(byId.get('job-1')).toMatchObject({ status: 'failed', durationMs: 50, result: { exitCode: 0 } });
  });

  test('an explicit completed status settles it', () => {
    const byId = roster(seeded());
    foldSettlements([hub([{ jobId: 'job-1', status: 'completed' }])], byId);
    expect(byId.get('job-1')!.status).toBe('completed');
  });

  test('a started or malformed job is skipped', () => {
    const byId = roster(seeded());
    foldSettlements([hub([{ id: 'job-1' }, 'nope', { id: 7 }])], byId);
    expect(byId.get('job-1')!.status).toBe('started');
  });

  test('a non-hub toolResult is not a settlement source', () => {
    const byId = roster(seeded());
    foldSettlements([{ type: 'message', message: { role: 'toolResult', toolName: 'bash', details: { jobs: [{ id: 'job-1', status: 'completed' }] } } }], byId);
    expect(byId.get('job-1')!.status).toBe('started');
  });
});

describe('history → roster projection', () => {
  test('marks the row as history with an infinitely old timestamp', () => {
    const info = historyEntryToSubagentInfo(seeded({ status: 'completed', durationMs: 1000 }));
    expect(info.source).toBe('history');
    expect(info.lastUpdate).toBe(0);
    expect(info.progress).toEqual({ durationMs: 1000 });
  });

  test('copies only the fields the progress row understands', () => {
    const info = historyEntryToSubagentInfo(seeded({
      lastIntent: 'reading', toolCount: 3, requests: 2, tokens: 10, contextTokens: 5, contextWindow: 100,
      cost: 0.5, durationMs: 1, resolvedModel: 'm-1', task: 't',
    }));
    expect(info.progress).toEqual({
      lastIntent: 'reading', toolCount: 3, requests: 2, tokens: 10, contextTokens: 5, contextWindow: 100, cost: 0.5, durationMs: 1, resolvedModel: 'm-1',
    });
    expect(info.task).toBe('t');
  });

  test('omits progress entirely when the entry carries none', () => {
    expect(historyEntryToSubagentInfo(seeded()).progress).toBeUndefined();
  });
});

describe('row formatters', () => {
  test('formatSubagentDuration covers seconds, minutes and invalid input', () => {
    expect(formatSubagentDuration(17_800)).toBe('17.8s');
    expect(formatSubagentDuration(64_000)).toBe('1m 4s');
    expect(formatSubagentDuration(0)).toBe('0.0s');
    expect(formatSubagentDuration(undefined)).toBe('');
    expect(formatSubagentDuration(-1)).toBe('');
    expect(formatSubagentDuration(Number.POSITIVE_INFINITY)).toBe('');
  });

  test('formatSubagentCost shows three decimals and drops zero', () => {
    expect(formatSubagentCost(0.003)).toBe('$0.003');
    expect(formatSubagentCost(1)).toBe('$1.000');
    expect(formatSubagentCost(0)).toBe('');
    expect(formatSubagentCost(-1)).toBe('');
    expect(formatSubagentCost(undefined)).toBe('');
  });

  test('formatSubagentMeta joins the present halves with a separator', () => {
    expect(formatSubagentMeta({ id: 'a', agent: 'task', status: 'started', index: 0, progress: { durationMs: 2000, cost: 0.01 } })).toBe('2.0s · $0.010');
    expect(formatSubagentMeta({ id: 'a', agent: 'task', status: 'started', index: 0, progress: { durationMs: 2000 } })).toBe('2.0s');
    expect(formatSubagentMeta({ id: 'a', agent: 'task', status: 'started', index: 0 })).toBe('');
  });
});

describe('fetchSubagentHistory', () => {
  /** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;
  const respond = (body: unknown, ok = true) => {
    globalThis.fetch = (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  };

  // Every case stubs the global; restoring only in the last one left the stub
  // installed for whatever ran next inside this process — including the rest of
  // THIS file, since a case is free to be the last one to run.
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('reads a top-level subagents array and drops malformed rows', async () => {
    respond({ subagents: [{ id: 'a', agent: 'task', status: 'completed', index: 0 }, { id: '', agent: 'x', status: 'started', index: 1 }] });
    const rows = await fetchSubagentHistory('s 1');
    expect(rows?.map((row) => ({ id: row.id, agent: row.agent, status: row.status, index: row.index }))).toEqual([
      { id: 'a', agent: 'task', status: 'completed', index: 0 },
    ]);
  });

  test('accepts the payload nested under `data`', async () => {
    respond({ data: { subagents: [{ id: 'a', agent: 'task', status: 'started', index: 0 }] } });
    expect((await fetchSubagentHistory('s1'))?.length).toBe(1);
  });

  test('a failed or malformed response means unavailable, never an empty roster', async () => {
    respond({ subagents: [] }, false);
    expect(await fetchSubagentHistory('s1')).toBeNull();
    respond({ nope: 1 });
    expect(await fetchSubagentHistory('s1')).toBeNull();
    respond(null);
    expect(await fetchSubagentHistory('s1')).toBeNull();
  });

  test('a thrown fetch is swallowed into null', async () => {
    globalThis.fetch = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await fetchSubagentHistory('s1')).toBeNull();
    globalThis.fetch = originalFetch;
  });
});
