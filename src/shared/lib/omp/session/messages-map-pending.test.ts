/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A tool call the transcript has no RESULT for.
 *
 * This is the shape a page reloaded mid-call reads: omp writes the assistant
 * turn's `toolCall` block and one `tool_execution_start` entry, then nothing
 * until the call returns. The two facts that shape carries are the call's only
 * clock and the fact that its output is UNKNOWN rather than empty — and both
 * were missing, so a reloaded `wait` lost its stopwatch and read as a settled
 * call with an empty body (the reported "wait renders as general after a
 * reload").
 *
 * The `liveRun` gate is the other half: the same transcript is left behind by a
 * run whose process DIED, and that call must not sit at `running` forever in
 * scrollback. Only a run in flight right now settles the difference.
 *
 * Split from `messages-map.test.ts`, which is at the repo's per-file ceiling.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectToolOutputs } from '@/shared/lib/omp/session/messages-map';
import { loadSessionMessages } from '@/server/lib/omp/session/messages';

const AT = '2026-01-02T03:04:05.000Z';

function startEntry(callId: string, toolName = 'wait'): Record<string, unknown> {
  return {
    type: 'custom',
    customType: 'tool_execution_start',
    timestamp: AT,
    data: { toolCallId: callId, toolName, startedAt: AT },
  };
}

function resultEntry(callId: string, text: string): Record<string, unknown> {
  return {
    type: 'message',
    id: 'r1',
    timestamp: AT,
    message: { role: 'toolResult', toolCallId: callId, content: [{ type: 'text', text }] },
  };
}

describe('collectToolOutputs — a call with no result', () => {
  test('is PENDING, and keeps the start clock', () => {
    const outputs = collectToolOutputs([startEntry('c')]);
    expect(outputs.get('c')).toMatchObject({ output: '', pending: true });
    expect(typeof outputs.get('c')?.startedAt).toBe('number');
  });

  test('a call that did return is not pending', () => {
    const outputs = collectToolOutputs([startEntry('c'), resultEntry('c', 'done')]);
    expect(outputs.get('c')?.output).toBe('done');
    expect(outputs.get('c')?.pending).toBeUndefined();
  });

  test('a resultless start followed by another result belongs to a DEAD run', () => {
    // omp writes a result before the next turn, so a gap can only mean the
    // process died mid-call. Marking that pending would leave a spinner in
    // scrollback for the rest of the session.
    const outputs = collectToolOutputs([
      startEntry('dead'),
      startEntry('next'),
      resultEntry('next', 'done'),
    ]);
    expect(outputs.get('dead')).toMatchObject({ output: '' });
    expect(outputs.get('dead')?.pending).toBeUndefined();
  });
});

describe('loadSessionMessages — a call in flight', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omp-pending-'));
  const file = join(dir, 'inflight.jsonl');
  writeFileSync(file, [
    JSON.stringify({ type: 'session', version: 3, id: 's1', timestamp: AT, cwd: dir }),
    JSON.stringify({
      type: 'message',
      id: 'a1',
      timestamp: AT,
      message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'wait', arguments: { i: 'waiting' } }] },
    }),
    JSON.stringify(startEntry('c1')),
  ].join('\n'));

  test('is running while the run is live', async () => {
    const [message] = await loadSessionMessages(file, { liveRun: true });
    expect(message?.toolCalls?.[0]).toMatchObject({ id: 'c1', status: 'running' });
    // No output was written, so none is claimed — the empty string would read
    // as "returned nothing".
    expect(message?.toolCalls?.[0]?.output).toBeUndefined();
    expect(typeof message?.toolCalls?.[0]?.startedAt).toBe('number');
  });

  test('is settled when no run is in flight, so a dead process leaves no spinner', async () => {
    const [message] = await loadSessionMessages(file);
    expect(message?.toolCalls?.[0]?.status).not.toBe('running');
    // The clock is still known — the start entry is a fact either way.
    expect(typeof message?.toolCalls?.[0]?.startedAt).toBe('number');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
