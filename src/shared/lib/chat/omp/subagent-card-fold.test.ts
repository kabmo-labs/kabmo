/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The subagent card, end to end on the CLIENT side.
 *
 * The server emits ordinary `message_*` + `tool_execution_*` frames for a child
 * (see `subagent-frames.ts`), so the claim "it renders" is only true if the
 * shared fold turns them into a `task` row with a live status. This runs the
 * real fold over the real frames: a child that starts, reports prose, and ends
 * must produce one card that stops running.
 */

import { describe, expect, test } from 'bun:test';
import type { ChatMessageData, OmpAgentCallbacks, OmpAgentState } from '@/shared/types';
import { foldAgentEvent, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/agent-events';
import { AcpSubagents, subagentCardStatus } from '@kabmo-labs/kabmo-acp-mapper/subagents';
import { subagentFrames } from '@kabmo-labs/kabmo-acp-mapper/subagent-frames';

function makeDeps() {
  const ended: ChatMessageData[] = [];
  const updates: ChatMessageData[] = [];
  const activity: string[] = [];
  let state: OmpAgentState = { isGenerating: false, connected: true, error: null };
  const callbacks: OmpAgentCallbacks = {
    onMessageEnd: (msg) => ended.push(msg),
    onMessageUpdate: (msg) => updates.push(msg),
    onActivity: (verb) => activity.push(verb),
  };
  const deps: OmpAgentFoldDeps = {
    sessionId: 's1',
    setState: (update) => {
      state = typeof update === 'function' ? update(state) : update;
    },
    callbacksRef: { current: callbacks },
    toolResultsRef: { current: new Map() },
    lastToolMessageRef: { current: null },
    activityRef: { current: '' },
    providerRetryVerbRef: { current: null },
    currentThinkingLevelRef: { current: undefined },
  };
  return { deps, ended, updates, activity, state: () => state };
}

describe('ACP subagent card renders through the shared fold', () => {
  test('a child becomes a task card that ends when the child ends', () => {
    const { deps, ended, updates } = makeDeps();
    const subagents = new AcpSubagents();
    subagents.apply({ sessionId: 'child-1', title: 'Investigator', description: 'Checks the build' });

    const first = subagents.get('child-1')!;
    for (const frame of subagentFrames(first, null)) foldAgentEvent(frame, deps);
    subagents.absorb('child-1', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Reading the failing test' },
    });
    const running = subagents.get('child-1')!;
    for (const frame of subagentFrames(running, subagentCardStatus(first))) foldAgentEvent(frame, deps);

    const streaming = updates.at(-1);
    expect(streaming?.toolCalls?.[0]).toMatchObject({ name: 'task', status: 'running' });

    subagents.absorb('child-1', { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
    const finished = subagents.get('child-1')!;
    for (const frame of subagentFrames(finished, subagentCardStatus(running))) foldAgentEvent(frame, deps);

    const closed = ended.at(-1);
    // The fold's own vocabulary: a finished call is `success`, not the wire's
    // `completed`.
    expect(closed?.toolCalls?.[0]).toMatchObject({ name: 'task', status: 'success' });
    expect(String(closed?.toolCalls?.[0]?.output)).toContain('Reading the failing test');
  });
});
