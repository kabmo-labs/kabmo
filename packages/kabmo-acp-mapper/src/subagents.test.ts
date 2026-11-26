/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The subagent registry: the patch rules the RFD defines, and the status the
 * card badge derives from the CHILD's own state.
 *
 * The bug these pin: a parent that announced a child had no record of it, so
 * the child's frames folded into the parent transcript and a child's permission
 * was parked under the parent's session id.
 */

import { describe, expect, test } from 'bun:test';
import { AcpSubagents,
subagentCardStatus,
subagentFinished, } from './subagents';

describe('ACP subagent registry', () => {
  test('an announcement registers the child with its association fields', () => {
    const subagents = new AcpSubagents();
    const record = subagents.apply({
      sessionId: 'child-1',
      title: 'Investigator',
      description: 'Looks into failures',
      capabilities: { cancel: {} },
      cwd: '/work',
    });
    expect(record).toMatchObject({
      sessionId: 'child-1',
      title: 'Investigator',
      description: 'Looks into failures',
      canCancel: true,
      cwd: '/work',
      state: 'unknown',
    });
    expect(subagents.has('child-1')).toBe(true);
  });

  test('omitted fields are unchanged and null clears them', () => {
    const subagents = new AcpSubagents();
    subagents.apply({ sessionId: 'child-1', title: 'Investigator', capabilities: { cancel: {} } });
    subagents.apply({ sessionId: 'child-1' });
    expect(subagents.get('child-1')).toMatchObject({ title: 'Investigator', canCancel: true });

    subagents.apply({ sessionId: 'child-1', title: null, capabilities: null });
    expect(subagents.get('child-1')).toMatchObject({ title: undefined, canCancel: false });
  });

  test('an update with no session id is not a record', () => {
    expect(new AcpSubagents().apply({ title: 'nameless' })).toBeNull();
  });

  test('the child’s own state decides the card status', () => {
    const subagents = new AcpSubagents();
    subagents.apply({ sessionId: 'child-1' });
    expect(subagentCardStatus(subagents.get('child-1')!)).toBe('running');

    subagents.absorb('child-1', { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
    expect(subagentCardStatus(subagents.get('child-1')!)).toBe('completed');
    expect(subagentFinished(subagents.get('child-1')!)).toBe(true);
  });

  test('an idle child that stopped with an error is failed, not completed', () => {
    const subagents = new AcpSubagents();
    subagents.apply({ sessionId: 'child-1' });
    subagents.absorb('child-1', {
      sessionUpdate: 'state_update',
      state: 'idle',
      stopReason: 'error',
      error: { message: 'provider refused' },
    });
    const record = subagents.get('child-1')!;
    expect(subagentCardStatus(record)).toBe('failed');
    expect(record.error).toBe('provider refused');
  });

  test('an idle child that was cancelled says so', () => {
    const subagents = new AcpSubagents();
    subagents.apply({ sessionId: 'child-1' });
    subagents.absorb('child-1', { sessionUpdate: 'state_update', state: 'idle', stopReason: 'cancelled' });
    expect(subagentCardStatus(subagents.get('child-1')!)).toBe('cancelled');
  });

  test('child prose accumulates and is what the card shows', () => {
    const subagents = new AcpSubagents();
    subagents.apply({ sessionId: 'child-1' });
    subagents.absorb('child-1', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Reading ' },
    });
    subagents.absorb('child-1', {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'the file' },
    });
    expect(subagents.get('child-1')!.activity).toBe('Reading the file');
  });

  test('a frame from an unannounced session is not adopted', () => {
    const subagents = new AcpSubagents();
    expect(subagents.absorb('stranger', { sessionUpdate: 'state_update', state: 'idle' })).toBeUndefined();
    expect(subagents.list()).toHaveLength(0);
  });

  test('liveness keeps a parent from being reclaimed under a working child', () => {
    const subagents = new AcpSubagents();
    subagents.apply({ sessionId: 'child-1', state: { state: 'running' } });
    expect(subagents.anyRunning()).toBe(true);
    subagents.absorb('child-1', { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
    expect(subagents.anyRunning()).toBe(false);
  });

  test('a dead parent closes every unfinished child', () => {
    const subagents = new AcpSubagents();
    subagents.apply({ sessionId: 'child-1', state: { state: 'running' } });
    subagents.apply({ sessionId: 'child-2', state: { state: 'idle', stopReason: 'end_turn' } });
    const changed = subagents.finishAll();
    expect(changed.map((record) => record.sessionId)).toEqual(['child-1']);
    expect(subagents.get('child-1')).toMatchObject({ state: 'idle', stopReason: 'cancelled' });
  });
});
