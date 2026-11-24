/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The address gate: a `session/update` belongs to the session it NAMES.
 *
 * Measured defect: a parent chat folded a child's frames into its own
 * transcript, because the router only asked "is a turn open?" and never compared
 * the frame's `sessionId`. Two sessions on one connection therefore shared one
 * timeline, and a child's permission request was parked under the parent's id.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { flushTicks, mountSession, notify } from '@/server/lib/harness/acp/session.test-util';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

async function runningTurn() {
  const mounted = mountSession();
  await mounted.session.send({ type: 'prompt', message: 'go' });
  await mounted.turn.started;
  return mounted;
}

describe('ACP session addressing', () => {
  test('a frame naming another session does not reach the parent transcript', async () => {
    const { session, events } = await runningTurn();
    const before = events.length;

    notify(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'child work' } }, 'child-1');

    const after = events.slice(before).map((event) => event.type);
    expect(after).not.toContain('message_update');
    expect(JSON.stringify(events.slice(before))).not.toContain('child work');
  });

  test('a frame for this session still folds', async () => {
    const { session, events } = await runningTurn();
    const before = events.length;
    notify(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'parent work' } }, 'acp-1');
    expect(events.slice(before).map((event) => event.type)).toContain('message_update');
  });

  test('an announced child draws its own card and absorbs its own traffic', async () => {
    const { session, events } = await runningTurn();
    notify(
      session,
      { sessionUpdate: 'subagent_update', sessionId: 'child-1', title: 'Investigator', state: { state: 'running' } },
      'acp-1',
    );
    const before = events.length;
    notify(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'child work' } }, 'child-1');

    const frames = events.slice(before);
    expect(frames.map((event) => event.type)).toEqual(['message_update', 'tool_execution_update']);
    expect(session.subagents.get('child-1')?.activity).toBe('child work');
  });

  test('a finished child closes its card once, and late traffic does not reopen it', async () => {
    const { session, events } = await runningTurn();
    notify(session, { sessionUpdate: 'subagent_update', sessionId: 'child-1', title: 'Investigator' }, 'acp-1');
    notify(session, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' }, 'child-1');
    const closed = events.filter((event) => event.type === 'tool_execution_end').length;
    expect(closed).toBe(1);

    const before = events.length;
    notify(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'late' } }, 'child-1');
    expect(events.slice(before)).toHaveLength(0);
  });

  test('the session reports itself busy while a child works', async () => {
    const { session, turn } = await runningTurn();
    notify(session, { sessionUpdate: 'subagent_update', sessionId: 'child-1', state: { state: 'running' } }, 'acp-1');
    turn.finish({ stopReason: 'end_turn' });
    await flushTicks();
    expect(session.isPromptRunning).toBe(false);
    expect(session.isBusy()).toBe(true);

    notify(session, { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' }, 'child-1');
    expect(session.isBusy()).toBe(false);
  });

  test('get_state lists the children the parent announced', async () => {
    const { session } = await runningTurn();
    notify(session, { sessionUpdate: 'subagent_update', sessionId: 'child-1', title: 'Investigator' }, 'acp-1');
    const state = session.webState();
    expect(state.protocolVersion).toBe(1);
    expect(state.subagents).toMatchObject([{ sessionId: 'child-1', title: 'Investigator' }]);
  });
});
