/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import type { ChatMessageData, OmpAgentCallbacks, OmpAgentState } from '@/shared/types';
import { foldAgentEvent, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/agent-events';
import { toChatMessage } from '@/shared/lib/omp/session/mapper';

/** Real shape omp writes on a user abort: empty content plus flat
 *  stopReason/errorMessage/errorId fields — there is no nested `error`. */
const ABORTED_TURN = {
  role: 'assistant',
  content: [{ type: 'text', text: '' }],
  provider: 'openai',
  model: 'gpt-5',
  stopReason: 'aborted',
  errorMessage: 'Interrupted by user',
  errorId: 67112960,
  timestamp: 1757943900000,
};

function makeDeps() {
  const ended: ChatMessageData[] = [];
  const updates: ChatMessageData[] = [];
  const activity: string[] = [];
  const commandOutputs: string[] = [];
  let settledCount = 0;
  let runEnds = 0;
  let state: OmpAgentState = { isGenerating: false, connected: true, error: null };
  const callbacks: OmpAgentCallbacks = {
    onMessageEnd: (msg) => ended.push(msg),
    onMessageUpdate: (msg) => updates.push(msg),
    onActivity: (verb) => activity.push(verb),
    onPromptSettled: () => { settledCount += 1; },
    onCommandOutput: (text) => commandOutputs.push(text),
    onAgentEnd: () => { runEnds += 1; },
  };
  const deps: OmpAgentFoldDeps = {
    sessionId: 's1',
    setState: (update) => {
      state = typeof update === 'function' ? update(state) : update;
    },
    callbacksRef: { current: callbacks },
    toolResultsRef: { current: new Map<string, { output: string }>() },
    lastToolMessageRef: { current: null },
    activityRef: { current: '' },
    providerRetryVerbRef: { current: null },
    currentThinkingLevelRef: { current: undefined },
  };
  return { deps, ended, updates, activity, commandOutputs, settled: () => settledCount, runEnds: () => runEnds, state: () => state };
}

describe('toChatMessage error derivation', () => {
  test('keeps an aborted turn that carries no text', () => {
    const msg = toChatMessage(ABORTED_TURN, false);
    expect(msg).not.toBeNull();
    expect(msg?.error?.message).toBe('Interrupted by user');
    expect(msg?.error?.stopReason).toBe('aborted');
  });

  test('leaves a normally finished turn without an error', () => {
    const msg = toChatMessage({ ...ABORTED_TURN, stopReason: 'end_turn', errorMessage: undefined }, false);
    expect(msg?.error).toBeUndefined();
  });
});

describe('foldAgentEvent prompt_result (builtin slash commands)', () => {
  test('agentInvoked:false settles generating state and fires onPromptSettled', () => {
    const { deps, state, settled } = makeDeps();
    foldAgentEvent({ type: 'agent_start' }, deps);
    expect(state().isGenerating).toBe(true);
    foldAgentEvent({ type: 'prompt_result', agentInvoked: false }, deps);
    expect(state().isGenerating).toBe(false);
    expect(settled()).toBe(1);
  });

  test('prompt_result with agentInvoked:true does not settle (a run follows)', () => {
    const { deps, settled } = makeDeps();
    foldAgentEvent({ type: 'prompt_result', agentInvoked: true }, deps);
    expect(settled()).toBe(0);
  });
});

describe('foldAgentEvent command_output (builtin slash output)', () => {
  test('forwards trimmed text to onCommandOutput', () => {
    const { deps, commandOutputs } = makeDeps();
    foldAgentEvent({ type: 'command_output', text: 'Usage\nInput tokens: 0\n' }, deps);
    expect(commandOutputs).toEqual(['Usage\nInput tokens: 0']);
  });

  test('drops empty output frames', () => {
    const { deps, commandOutputs } = makeDeps();
    foldAgentEvent({ type: 'command_output', text: '   ' }, deps);
    foldAgentEvent({ type: 'command_output' }, deps);
    expect(commandOutputs).toEqual([]);
  });
});

describe('foldAgentEvent activity phrases', () => {
  test('names the tool being executed, not a generic reasoning verb', () => {
    const { deps, activity } = makeDeps();
    foldAgentEvent({ type: 'agent_start' }, deps);
    foldAgentEvent({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'edit',
      args: { path: 'app/lib/chat/order.ts', old_string: 'a', new_string: 'b' },
    }, deps);
    expect(activity).toEqual(['Thinking', 'Editing app/lib/chat/order.ts']);
  });

  test('resolves an xd:// device write to the device action', () => {
    const { deps, activity } = makeDeps();
    foldAgentEvent({
      type: 'tool_execution_start',
      toolCallId: 'c2',
      toolName: 'write',
      args: { path: 'xd://ast_edit', content: JSON.stringify({ pat: 'x', out: 'y', paths: ['src/**/*.ts'] }) },
    }, deps);
    expect(activity).toEqual(['Rewriting AST src/**/*.ts']);
  });

  test('follows the assistant phase before any tool starts', () => {
    const { deps, activity } = makeDeps();
    foldAgentEvent({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'thinking_delta', delta: 'x' } }, deps);
    foldAgentEvent({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: 'x' } }, deps);
    foldAgentEvent({
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: { type: 'toolcall_end', toolCall: { id: 'c3', name: 'bash', arguments: { command: 'bun test' } } },
    }, deps);
    expect(activity).toEqual(['Thinking', 'Writing response', 'Running bun test']);
  });

  test('names the tool as soon as its call starts streaming, with no preparing state', () => {
    const { deps, activity } = makeDeps();
    // omp puts the streaming call at partial.content[contentIndex] while the
    // event's own `toolCall` field only lands on toolcall_end.
    const streaming = (name: string) => ({
      type: 'message_update',
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, partial: { content: [{ type: 'toolCall', name, arguments: {} }] } },
    });
    foldAgentEvent(streaming('write'), deps);
    foldAgentEvent({ ...streaming('edit'), assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, partial: { content: [{ type: 'toolCall', name: 'edit', arguments: {} }] } } }, deps);
    expect(activity).toEqual(['Writing', 'Editing']);
  });

  test('reports Thinking, not a results phase, once a tool returns', () => {
    const { deps, activity } = makeDeps();
    foldAgentEvent({ type: 'tool_execution_start', toolCallId: 'c5', toolName: 'bash', args: { command: 'ls' } }, deps);
    foldAgentEvent({ type: 'tool_execution_end', toolCallId: 'c5', result: { content: [{ type: 'text', text: 'ok' }] } }, deps);
    expect(activity).toEqual(['Running ls', 'Thinking']);
  });

  test('does not re-publish the same phrase for per-token frames', () => {
    const { deps, activity } = makeDeps();
    for (let i = 0; i < 5; i++) {
      foldAgentEvent({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'thinking_delta', delta: 'x' } }, deps);
    }
    expect(activity).toEqual(['Thinking']);
  });

  test('keeps a complete phrase when a tool call carries no arguments', () => {
    const { deps, activity } = makeDeps();
    // A model can emit `arguments: {}` (seen with deepseek-v4-flash): the tool
    // name alone must still read as an activity, never a dangling verb.
    foldAgentEvent({ type: 'tool_execution_start', toolCallId: 'c4', toolName: 'bash', args: {} }, deps);
    expect(activity).toEqual(['Running']);
  });
});

describe('foldAgentEvent tool images', () => {
  const IMAGE_MSG = {
    role: 'assistant',
    id: 'm1',
    content: [
      { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: '/tmp/shiki96.png' } },
    ],
  };

  test('a read result pairs its image onto the tool call', () => {
    // A `read` of an image answers with the picture itself, and the panel has
    // no other way to reach it: the PATH is routinely outside the browse scope
    // (`/tmp/...`), so `/api/fs/raw` refuses it and the result's own bytes are
    // the only copy the timeline can paint. The pairing re-emits the message,
    // so the assertion reads the update channel the timeline subscribes to.
    const { deps, updates } = makeDeps();
    foldAgentEvent({ type: 'message_end', message: IMAGE_MSG }, deps);
    foldAgentEvent({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      result: {
        content: [
          { type: 'text', text: 'Read image file [image/jpeg]' },
          { type: 'image', data: `blob:sha256:${'a'.repeat(64)}`, mimeType: 'image/jpeg' },
        ],
      },
    }, deps);

    expect(updates.at(-1)?.toolCalls?.[0]?.images).toEqual([
      { mimeType: 'image/jpeg', blobRef: `blob:sha256:${'a'.repeat(64)}` },
    ]);
  });

  test('a result with no image leaves the field unset', () => {
    // The fallback (re-read the path) must only fire for a call whose result
    // genuinely carried no picture — a text read is not an image read.
    const { deps, updates } = makeDeps();
    foldAgentEvent({ type: 'message_end', message: IMAGE_MSG }, deps);
    foldAgentEvent({ type: 'tool_execution_end', toolCallId: 'c1', result: { content: [{ type: 'text', text: '1: hello' }] } }, deps);

    expect(updates.at(-1)?.toolCalls?.[0]?.images).toBeUndefined();
  });
});

describe('foldAgentEvent agent_end', () => {
  test('materializes an aborted turn that never arrived as message_end', () => {
    const { deps, ended } = makeDeps();
    foldAgentEvent({ type: 'agent_start' }, deps);
    foldAgentEvent({ type: 'agent_end', messages: [ABORTED_TURN] }, deps);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.error?.message).toBe('Interrupted by user');
    expect(ended[0]?.error?.stopReason).toBe('aborted');
  });

  test('ignores a turn that finished normally', () => {
    const { deps, ended } = makeDeps();
    foldAgentEvent({ type: 'agent_end', messages: [{ ...ABORTED_TURN, stopReason: 'end_turn' }] }, deps);
    expect(ended).toHaveLength(0);
  });

  test('a non-terminal agent_end keeps the run generating and does not fire onAgentEnd', () => {
    // omp's shape when the turn yields with work still alive — a detached
    // subagent, a compaction, a background job. Measured on omp 18.3.2: with an
    // async subagent, this frame lands ~14s BEFORE the subagent finishes, and
    // treating it as the run end blanked the generating indicator for the whole
    // stretch the roster was still showing a live child.
    const { deps, state, runEnds } = makeDeps();
    foldAgentEvent({ type: 'agent_start' }, deps);
    expect(state().isGenerating).toBe(true);

    foldAgentEvent({ type: 'agent_end', isTerminal: false, messages: [] }, deps);
    expect(state().isGenerating).toBe(true);
    expect(runEnds()).toBe(0);

    // The continuation ends the run for real; only now may the UI settle.
    foldAgentEvent({ type: 'agent_start' }, deps);
    foldAgentEvent({ type: 'agent_end', isTerminal: true, messages: [] }, deps);
    expect(state().isGenerating).toBe(false);
    expect(runEnds()).toBe(1);
  });

  test('an agent_end with no isTerminal field is treated as terminal', () => {
    // The field is optional: a frame that omits it is a normal run end.
    const { deps, state, runEnds } = makeDeps();
    foldAgentEvent({ type: 'agent_start' }, deps);
    foldAgentEvent({ type: 'agent_end', messages: [] }, deps);
    expect(state().isGenerating).toBe(false);
    expect(runEnds()).toBe(1);
  });

  test('an attempt re-entering the loop does not wipe the retry phrase', () => {
    // Every retry of a provider-error saga opens a fresh `agent_start`, and
    // `onAgentStart` publishes "Thinking" itself — so the fold's ref-aware
    // publish has to come after the callback, or the phrase the user needs is
    // replaced a frame after it appears (measured on a real quota wall).
    const { deps, activity } = makeDeps();
    deps.providerRetryVerbRef.current = 'Retrying after a provider error 2/3 · next in 4s';
    foldAgentEvent({ type: 'agent_start' }, deps);
    expect(activity.at(-1)).toBe('Retrying after a provider error 2/3 · next in 4s');
  });

  test('a terminal run end closes the retry saga', () => {
    const { deps, activity } = makeDeps();
    deps.providerRetryVerbRef.current = 'Retrying after a provider error 3/3 · next in 4s';
    foldAgentEvent({ type: 'agent_end', isTerminal: true, messages: [] }, deps);
    expect(deps.providerRetryVerbRef.current).toBeNull();
    expect(activity.at(-1)).toBe('Thinking');
  });
});

describe('foldAgentEvent tool_execution_update (running tool output)', () => {
  /** One snapshot frame, in the shape omp actually sends. */
  const update = (text: string) => ({
    type: 'tool_execution_update',
    toolCallId: 'call-1',
    toolName: 'bash',
    partialResult: { content: [{ type: 'text', text }] },
  });

  test('a partial result REPLACES the stored output instead of appending', () => {
    // omp's `partialResult` is the tool's output so far, not the fragment since
    // the previous frame. Measured on 18.3.0 and 18.8.3: a bash loop echoing
    // one line per second reports "L1", then "L1\nL2", then "L1\nL2\nL3".
    // Appending those snapshots produced "L1\nL1\nL2\nL1\nL2\nL3" on a card
    // that was still running.
    const { deps } = makeDeps();
    foldAgentEvent(update('L1\n') as never, deps);
    foldAgentEvent(update('L1\nL2\n') as never, deps);
    foldAgentEvent(update('L1\nL2\nL3\n') as never, deps);
    expect(deps.toolResultsRef.current?.get('call-1')?.output).toBe('L1\nL2\nL3\n');
  });
});
