/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The live-stream bookkeeping modules: tool-output pairing and its caps, the
 * activity/indicator deps helpers, the terminal-message flush for turns that
 * stopped abnormally, the stream-status window event, and the file-mutation
 * signal.
 *
 * Each one hides a failure mode that is invisible until it bites: an unbounded
 * tool-output map grows forever, an unpaired tool result renders a spinner that
 * never resolves, an aborted turn never renders live, a status event published
 * on every frame re-renders the whole navbar, and a `write xd://lsp` treated as
 * a workspace write refreshes the git panel on every LSP call.
 */

import { describe, expect, test } from 'bun:test';
import type { ChatMessageData } from '@/shared/types';
import type { OmpAgentFoldDeps } from '@/shared/lib/chat/omp/fold-deps';
import { setActivity, toolHost } from '@/shared/lib/chat/omp/fold-deps';
import { materializeTerminalMessages } from '@/shared/lib/chat/omp/terminal-messages';
import {
  pairToolOutputs,
  putToolResult,
  recordToolResult,
  refreshToolMessage,
  type ToolResultRecord,
} from '@/shared/lib/chat/omp/tool-results';

/** Full deps record with every ref fresh, so tests never share state. */
function makeDeps(): OmpAgentFoldDeps {
  const deps = {
    sessionId: 's1',
    setState: () => {},
    callbacksRef: { current: {} },
    toolResultsRef: { current: new Map<string, ToolResultRecord>() },
    lastToolMessageRef: { current: { id: 'last', role: 'ai', content: '' } as ChatMessageData },
    activityRef: { current: '' },
    providerRetryVerbRef: { current: null },
    currentThinkingLevelRef: { current: undefined },
    fileMutatingCallsRef: { current: new Set<string>() },
  };
  return deps as unknown as OmpAgentFoldDeps;
}

function toolMessage(ids: string[]): ChatMessageData {
  return {
    id: 'm1',
    role: 'ai',
    content: '',
    toolCalls: ids.map((id) => ({ id, type: 'bash', title: 'Bash', status: 'running' as const })),
  };
}

describe('tool-results', () => {
  test('pairToolOutputs joins a stored result onto its call and marks success', () => {
    const deps = makeDeps();
    putToolResult(deps, 'c1', { output: 'hello' });

    const paired = pairToolOutputs(toolMessage(['c1', 'c2']), deps);
    expect(paired.toolCalls?.[0]).toMatchObject({ id: 'c1', output: 'hello', status: 'success' });
    // A call with no stored result is left exactly as it was.
    expect(paired.toolCalls?.[1]).toMatchObject({ id: 'c2', status: 'running' });
  });

  test('an isError result pairs as an error, and the call keeps its own details', () => {
    const deps = makeDeps();
    putToolResult(deps, 'c1', { output: 'boom', isError: true, details: { from: 'result' } });
    const msg = toolMessage(['c1']);
    msg.toolCalls![0].details = { from: 'call' };

    const paired = pairToolOutputs(msg, deps);
    expect(paired.toolCalls?.[0].status).toBe('error');
    expect(paired.toolCalls?.[0].details).toEqual({ from: 'call' });
  });

  test('a message with no tool calls is returned unchanged (same object)', () => {
    const deps = makeDeps();
    const msg: ChatMessageData = { id: 'm', role: 'ai', content: 'hi' };
    expect(pairToolOutputs(msg, deps)).toBe(msg);
  });

  test('putToolResult caps output at 200k chars, keeping the tail', () => {
    const deps = makeDeps();
    const head = 'H'.repeat(200_000);
    putToolResult(deps, 'c1', { output: `${head}TAIL` });

    const stored = deps.toolResultsRef.current!.get('c1')!;
    // The marker rides ON TOP of the cap, so the stored string is the tail plus
    // the cut notice — never the whole 200k+4 payload.
    expect(stored.output).toBe(`…[truncated]\n${`${head}TAIL`.slice(-200_000)}`);
    expect(stored.output.length).toBe('…[truncated]\n'.length + 200_000);
  });

  test('putToolResult evicts the oldest entry past 200 tracked results', () => {
    const deps = makeDeps();
    for (let i = 0; i < 201; i += 1) putToolResult(deps, `c${i}`, { output: String(i) });

    const map = deps.toolResultsRef.current!;
    expect(map.size).toBe(200);
    expect(map.has('c0')).toBe(false);
    expect(map.has('c200')).toBe(true);
  });

  test('recordToolResult ignores a frame with no call id and keeps the rest', () => {
    const deps = makeDeps();
    recordToolResult({ content: 'orphan' }, deps);
    expect(deps.toolResultsRef.current!.size).toBe(0);

    recordToolResult({ toolCallId: 'c1', content: 'text', details: 'not-an-object' }, deps);
    const stored = deps.toolResultsRef.current!.get('c1')!;
    expect(stored.output).toBe('text');
    expect(stored.details).toBeUndefined();
    expect(stored.images).toBeUndefined();
  });

  test('recordToolResult extracts images only when the result carries one', () => {
    const deps = makeDeps();
    recordToolResult(
      { toolCallId: 'c1', content: [{ type: 'text', text: 'Read image' }, { type: 'image', data: 'abc', mimeType: 'image/jpeg' }] },
      deps,
    );
    const stored = deps.toolResultsRef.current!.get('c1')!;
    expect(stored.output).toBe('Read image');
    expect(stored.images).toEqual([{ mimeType: 'image/jpeg', dataBase64: 'abc' }]);
  });

  test('refreshToolMessage re-emits only when the call belongs to the last tool message', () => {
    const deps = makeDeps();
    const updates: ChatMessageData[] = [];
    deps.onMessageUpdate = (m) => updates.push(m);
    deps.lastToolMessageRef.current = toolMessage(['c1']);
    putToolResult(deps, 'c1', { output: 'out' });

    refreshToolMessage(undefined, deps);
    refreshToolMessage('other', deps);
    expect(updates.length).toBe(0);

    refreshToolMessage('c1', deps);
    expect(updates.length).toBe(1);
    expect(updates[0].toolCalls?.[0]).toMatchObject({ output: 'out', status: 'success' });
  });

  test('a result pairs onto the transcript row a RELOAD put on screen', () => {
    // A page reload re-reads the JSONL and mounts a fresh fold, so
    // `lastToolMessageRef` is null while the card for the still-running call is
    // already rendered. Without the transcript lookup the result had no target
    // and the card kept the transcript's detail-less shape for the whole run.
    const deps = makeDeps();
    const updates: ChatMessageData[] = [];
    deps.onMessageUpdate = (m) => updates.push(m);
    deps.lastToolMessageRef.current = null as unknown as ChatMessageData;
    const resumed = toolMessage(['c1']);
    deps.resumedToolMessage = (callId) => (callId === 'c1' ? resumed : undefined);
    putToolResult(deps, 'c1', { output: 'settled', details: { op: 'wait', jobs: [] } });

    refreshToolMessage('c1', deps);

    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('m1');
    expect(updates[0].toolCalls?.[0]).toMatchObject({ output: 'settled', status: 'success' });
    // Adopted: the next frame finds it without asking the transcript again.
    expect(deps.lastToolMessageRef.current).toBe(resumed);
  });

  test('an unknown call id still re-emits nothing', () => {
    const deps = makeDeps();
    const updates: ChatMessageData[] = [];
    deps.onMessageUpdate = (m) => updates.push(m);
    deps.lastToolMessageRef.current = null as unknown as ChatMessageData;
    deps.resumedToolMessage = () => undefined;
    putToolResult(deps, 'c9', { output: 'x' });

    refreshToolMessage('c9', deps);
    expect(updates).toHaveLength(0);
  });
});

describe('fold-deps helpers', () => {
  test('setActivity skips an empty verb and a repeat of the current one', () => {
    const deps = makeDeps();
    const seen: string[] = [];
    if (!deps.callbacksRef.current) throw new Error('expected live callbacks');
    deps.callbacksRef.current.onActivity = (v) => seen.push(v);

    setActivity(undefined, deps);
    setActivity('Reading a.ts', deps);
    setActivity('Reading a.ts', deps);
    setActivity('Writing b.ts', deps);

    expect(seen).toEqual(['Reading a.ts', 'Writing b.ts']);
    expect(deps.activityRef.current).toBe('Writing b.ts');
  });

  test('toolHost exposes the deps plus the current onMessageUpdate sink', () => {
    const deps = makeDeps();
    const sink = () => {};
    if (!deps.callbacksRef.current) throw new Error('expected live callbacks');
    deps.callbacksRef.current.onMessageUpdate = sink;

    const host = toolHost(deps);
    expect(host.onMessageUpdate).toBe(sink);
    expect(host.toolResultsRef).toBe(deps.toolResultsRef);
  });
});

describe('materializeTerminalMessages', () => {
  test('a non-terminal frame yields nothing', () => {
    const deps = makeDeps();
    expect(materializeTerminalMessages({ type: 'agent_end', isTerminal: false, messages: [{ role: 'assistant', stopReason: 'aborted' }] }, deps, undefined)).toEqual({});
  });

  test('a frame with no messages array yields nothing', () => {
    const deps = makeDeps();
    expect(materializeTerminalMessages({ type: 'agent_end', messages: 'nope' }, deps, undefined)).toEqual({});
    expect(materializeTerminalMessages({ type: 'agent_end' }, deps, undefined)).toEqual({});
  });

  test('flushes an aborted assistant turn and reports its errorMessage', () => {
    const deps = makeDeps();
    const ends: ChatMessageData[] = [];
    const result = materializeTerminalMessages(
      {
        type: 'agent_end',
        isTerminal: true,
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', id: 'm1', content: 'partial', stopReason: 'aborted', errorMessage: 'user aborted' },
        ],
      },
      deps,
      { onMessageEnd: (m) => ends.push(m) },
    );

    expect(result.errorMessage).toBe('user aborted');
    expect(ends.length).toBe(1);
    expect(ends[0].id).toBe('m1');
    expect(ends[0].content).toBe('partial');
  });

  test('skips a normally-finished assistant turn and non-object entries', () => {
    const deps = makeDeps();
    const ends: ChatMessageData[] = [];
    const result = materializeTerminalMessages(
      {
        type: 'agent_end',
        isTerminal: true,
        messages: [null, 'junk', [], { role: 'assistant', id: 'm1', content: 'done', stopReason: 'end' }],
      },
      deps,
      { onMessageEnd: (m) => ends.push(m) },
    );

    expect(result.errorMessage).toBeUndefined();
    expect(ends.length).toBe(0);
  });

  test('pairs stored tool output and remembers the last tool message', () => {
    const deps = makeDeps();
    putToolResult(deps, 'c1', { output: 'log tail' });
    const ends: ChatMessageData[] = [];
    materializeTerminalMessages(
      {
        type: 'agent_end',
        isTerminal: true,
        messages: [
          { role: 'assistant', id: 'm1', stopReason: 'error', errorMessage: 'provider 500', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }] },
        ],
      },
      deps,
      { onMessageEnd: (m) => ends.push(m) },
    );

    expect(ends[0].toolCalls?.[0]).toMatchObject({ id: 'c1', output: 'log tail', status: 'success' });
    expect(deps.lastToolMessageRef.current).toBe(ends[0]);
  });
});
