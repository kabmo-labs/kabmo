/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wiring must let the background notice MOVE the session's counters.
 *
 * Measured against a real agy chat: the notice was finally delivered after a
 * subagent turn, and it threw `Attempted to assign to readonly property` inside
 * `deliverBackgroundNotice` because the counts were getter-only. The whole
 * "did the subagent report back" path had already run; only the last step
 * failed, so a unit test that never writes the counts could not catch it.
 */

import { describe, expect, test } from 'bun:test';
import { acpWiringFor } from '@kabmo-labs/kabmo-acp-session-core/session-wiring';
import { deliverBackgroundNotice } from '@kabmo-labs/kabmo-acp-session-core/background-work';

function session() {
  return {
    cwd: '/tmp',
    sessionId: 's1',
    runModel: { provider: 'p', modelId: 'm' },
    messageCount: 2,
    assistantCount: 1,
    emit: () => {},
    onTurnEnded: async () => {},
    send: async () => ({}),
    isAlive: () => true,
  };
}

const parts = {
  proc: {} as never,
  mapper: {} as never,
  idle: {} as never,
};

describe('acpWiringFor', () => {
  test('reads the counts live', () => {
    const target = session();
    const wiring = acpWiringFor(target, parts);
    target.messageCount = 9;
    expect(wiring.messageCount).toBe(9);
  });

  test('lets a delivered notice increment them, as the real path does', () => {
    const target = session();
    const wiring = acpWiringFor(target, parts);
    expect(() => deliverBackgroundNotice(wiring, 'the subagent finished')).not.toThrow();
    expect(target.messageCount).toBe(3);
    expect(target.assistantCount).toBe(2);
  });
});
