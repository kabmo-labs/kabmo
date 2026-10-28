/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Covers `readSubagentProgressFrame`, the one reader every subagent-progress
 * consumer goes through (sidebar roster, transcript hook, server liveness).
 *
 * The wrapper shape is the whole point: omp's `subagent_progress` frame nests
 * the child's `AgentProgress` under `payload.progress` and puts NO `id` on the
 * wrapper, so a reader that parses the wrapper alone yields an id-less object
 * with none of the reported fields — silently, because every field is
 * optional. The payload below is a verbatim frame captured from omp 18.3.2.
 */

import { describe, expect, test } from 'bun:test';

import { parseSubagentProgress, readSubagentProgressFrame } from '@/shared/lib/omp/subagent/parse';

/** One `subagent_progress` frame as omp emits it (trimmed to the read fields). */
const REAL_FRAME = {
  index: 0,
  agent: 'scout',
  agentSource: 'user',
  task: 'Complete assignment thoroughly:\n\n# Target\nCount files.',
  parentToolCallId: 'call_00_LsrwnITatwhVYX5NElPf2544',
  detached: true,
  assignment: '# Target\nCount files.',
  sessionFile: '/tmp/sessions/parent/CountTsx.jsonl',
  progress: {
    index: 0,
    id: 'CountTsx',
    agent: 'scout',
    agentSource: 'user',
    status: 'running',
    task: 'Complete assignment thoroughly:\n\n# Target\nCount files.',
    recentTools: [],
    recentOutput: [],
    toolCount: 3,
    requests: 2,
    tokens: 10400,
    cost: 0.003,
    durationMs: 8700,
    modelRole: 'smol',
    resolvedModelIdentity: 'kenari/deepseek-v4-flash',
    resolvedThinkingLevel: 'low',
    resolvedModel: 'kenari/deepseek-v4-flash:low',
    resolvedModelIsFallback: false,
  },
};

describe('readSubagentProgressFrame', () => {
  test('unwraps the nested AgentProgress and keeps the fields it reports', () => {
    const progress = readSubagentProgressFrame(REAL_FRAME);
    expect(progress?.id).toBe('CountTsx');
    expect(progress?.resolvedModel).toBe('kenari/deepseek-v4-flash:low');
    expect(progress?.resolvedThinkingLevel).toBe('low');
    expect(progress?.status).toBe('running');
    expect(progress?.tokens).toBe(10400);
  });

  test('reads a bare AgentProgress payload (snapshot field, not a frame)', () => {
    const progress = readSubagentProgressFrame(REAL_FRAME.progress);
    expect(progress?.id).toBe('CountTsx');
    expect(progress?.resolvedThinkingLevel).toBe('low');
  });

  test('keeps the wrapper id when the nested snapshot omits it', () => {
    const progress = readSubagentProgressFrame({ id: 'Wrapped', progress: { status: 'running' } });
    expect(progress?.id).toBe('Wrapped');
    expect(progress?.status).toBe('running');
  });

  test('returns undefined for a payload carrying no progress fields at all', () => {
    expect(readSubagentProgressFrame({ event: { type: 'message_end' } })).toBeUndefined();
    expect(readSubagentProgressFrame(null)).toBeUndefined();
    expect(readSubagentProgressFrame('nonsense')).toBeUndefined();
  });
});

describe('parseSubagentProgress', () => {
  test('carries the resolved thinking level and drops a non-string one', () => {
    expect(parseSubagentProgress({ resolvedThinkingLevel: 'max' })?.resolvedThinkingLevel).toBe('max');
    expect(parseSubagentProgress({ resolvedThinkingLevel: null })?.resolvedThinkingLevel).toBeUndefined();
    expect(parseSubagentProgress({ resolvedThinkingLevel: 3 })?.resolvedThinkingLevel).toBeUndefined();
  });
});
