/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP idle reclaim.
 *
 * `omp acp` children used to outlive the tab that spawned them by hours: unlike
 * the omp wrapper, this transport had no idle clock, and nothing else ends a
 * child it is not actively driving. These cases pin the two halves of the fix —
 * the decision (never reclaim a working or dialog-blocked session) and the
 * wiring (commands and frames defer the deadline; a destroy stops it).
 */

import { describe, expect, test } from 'bun:test';

import { reclaimIdleAcpSession } from '@/server/lib/harness/acp/session-idle';
import { UNPROBED_CAPABILITIES } from '@/server/lib/harness/capabilities';
import { mountSession, notify } from '@/server/lib/harness/acp/session.test-util';

describe('ACP idle reclaim decision', () => {
  const restorable = { ...UNPROBED_CAPABILITIES, loadSession: true };

  test('an idle restorable session is destroyed', () => {
    let destroyed = 0;
    const reclaimed = reclaimIdleAcpSession({
      harness: 'claude',
      capabilities: { ...restorable },
      isBusy: () => false,
      destroy: () => { destroyed += 1; },
    });
    expect(reclaimed).toBe(true);
    expect(destroyed).toBe(1);
  });

  test('a busy session survives and the clock re-arms instead', () => {
    let destroyed = 0;
    const reclaimed = reclaimIdleAcpSession({
      harness: 'claude',
      capabilities: { ...restorable },
      isBusy: () => true,
      destroy: () => { destroyed += 1; },
    });
    // `false` is what makes `IdleReaper` re-arm from now: answering `true`
    // would let it fire again on an unchanged session.
    expect(reclaimed).toBe(false);
    expect(destroyed).toBe(0);
  });

  test('an idle session whose agent cannot session/load is left alive', () => {
    // There is no way back: `resumeRecordedHarnessSession` refuses to spawn a
    // fresh agent under the chat's id, so reclaiming would strand the chat.
    let destroyed = 0;
    reclaimIdleAcpSession({
      harness: 'dsh',
      capabilities: { ...UNPROBED_CAPABILITIES, loadSession: false },
      isBusy: () => false,
      destroy: () => { destroyed += 1; },
    });
    expect(destroyed).toBe(0);
  });

  test('omp-acp is reclaimed even without loadSession, because its session file restores it', () => {
    let destroyed = 0;
    reclaimIdleAcpSession({
      harness: 'omp-acp',
      capabilities: { ...UNPROBED_CAPABILITIES, loadSession: false },
      isBusy: () => false,
      destroy: () => { destroyed += 1; },
    });
    expect(destroyed).toBe(1);
  });
});

describe('ACP idle reclaim wiring', () => {
  test('a dispatched command defers the deadline', async () => {
    const { session, turn, idleResets } = mountSession();
    expect(idleResets()).toBe(0);
    await session.send({ type: 'get_state' });
    expect(idleResets()).toBe(1);
    turn.finish({ stopReason: 'end_turn' });
  });

  test('a frame defers the deadline', () => {
    const { session, idleResets } = mountSession();
    notify(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } });
    expect(idleResets()).toBe(1);
  });

  test('destroy stops the clock', async () => {
    const { session, idleStopped } = mountSession();
    await session.destroyAndWait();
    expect(idleStopped()).toBe(true);
  });
});
