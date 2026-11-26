/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one failure that is recoverable but is not a retry.
 *
 * An agent that says "session not found" (or answers `-32002`) will say it for
 * every later prompt in this process, so a turn that reports it must also drop
 * the session: the route then respawns and resumes the agent's own history. The
 * alternative — a chat that answers every send with the same refusal — is what
 * this pins.
 */

import { describe, expect, test } from 'bun:test';
import { isLostSession, LOST_SESSION_NOTICE } from '@kabmo-labs/kabmo-acp-session/session-lost';

describe('isLostSession', () => {
  test('recognises the spellings adapters use', () => {
    for (const message of [
      'session not found',
      'Session 01a1b4cc-… not found',
      'session lock unavailable',
      'no such session: abc',
    ]) {
      expect(isLostSession(message)).toBe(true);
    }
  });

  test('recognises the spec code even when the wording differs', () => {
    expect(isLostSession('Resource not found', -32002)).toBe(true);
  });

  test('a normal failure is not a lost session', () => {
    expect(isLostSession('The model rejected the request')).toBe(false);
    expect(isLostSession(null)).toBe(false);
    expect(isLostSession('rate limited', -32003)).toBe(false);
  });

  test('the notice names the recovery', () => {
    expect(LOST_SESSION_NOTICE).toContain('restores it');
  });
});
