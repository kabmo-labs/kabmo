/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Who may be replayed into Kabmo's transcript.
 *
 * The gate used to be `origin === 'imported'`, which assumed every chat Kabmo
 * spawned had a client-written transcript. A child spawned SERVER-SIDE (an
 * orchestration worker, a CLI child) has no tab, so that assumption left its
 * timeline empty. The gate is now the local transcript itself.
 */

import { describe, expect, test } from 'bun:test';
import { restoreEligible } from '@/server/routes/agent/harness-command';
import { hasAssistantRow } from '@kabmo-labs/kabmo-chat/rows/transcript-rows';
import type { HarnessSessionRecord } from '@kabmo-labs/kabmo-harness/session/session-store.server';

function record(overrides: Partial<HarnessSessionRecord> = {}): HarnessSessionRecord {
  return {
    sessionId: 'child-1',
    harness: 'claude',
    agentSessionId: 'child-1',
    cwd: '/work',
    origin: '',
    ...overrides,
  };
}

describe('restoreEligible', () => {
  test('a spawned child with no local transcript is eligible', () => {
    expect(restoreEligible(record(), [])).toBe(true);
  });

  test('an imported chat is eligible', () => {
    expect(restoreEligible(record({ origin: 'imported' }), [])).toBe(true);
  });

  test('a user-only row is not a transcript yet', () => {
    expect(restoreEligible(record(), [{ role: 'user', content: 'do the task' }])).toBe(true);
  });

  test('a local assistant row is a transcript and is not replayed', () => {
    expect(restoreEligible(record(), [
      { role: 'user', content: 'do the task' },
      { role: 'ai', content: 'done' },
    ])).toBe(false);
  });

  test('omp owns its own transcript and is never replayed', () => {
    expect(restoreEligible(record({ harness: 'omp-rpc' }), [])).toBe(false);
  });

  test('a record with no cwd cannot be resumed', () => {
    expect(restoreEligible(record({ cwd: '' }), [])).toBe(false);
  });

  test('no record is not eligible', () => {
    expect(restoreEligible(null, [])).toBe(false);
  });
});

describe('hasAssistantRow', () => {
  test('recognises both spellings of the assistant role', () => {
    expect(hasAssistantRow([{ role: 'ai' }])).toBe(true);
    expect(hasAssistantRow([{ role: 'assistant' }])).toBe(true);
    expect(hasAssistantRow([{ role: 'user' }])).toBe(false);
    expect(hasAssistantRow(null)).toBe(false);
  });
});
