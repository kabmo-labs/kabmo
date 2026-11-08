/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The context ring's numbers for an ACP chat.
 *
 * ACP reports context size/used and a cost; everything else is unknown. Those
 * fields must reach the panel, and the unknown ones must stay zero rather than
 * be invented from a transcript that does not exist.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { buildAcpTelemetry, loadAcpUsage, saveAcpUsage, type AcpTelemetrySession } from '@/server/lib/harness/acp/acp-telemetry.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

const session = {
  sessionId: 'acp-1',
  messageCount: 7,
  promptCount: 3,
  assistantCount: 4,
  contextUsage: { tokens: 12_000, contextWindow: 100_000, percent: 12 },
  totalCost: 0.0123,
  runModel: { provider: 'claude', modelId: 'opus' },
};

describe('buildAcpTelemetry', () => {
  test('maps the usage ACP reports and the counts the session tracks', () => {
    const telemetry = buildAcpTelemetry(session, 'Fix the importer');
    expect(telemetry).toMatchObject({
      sessionId: 'acp-1',
      sessionTitle: 'Fix the importer',
      modelId: 'claude/opus',
      modelName: 'opus',
      contextUsed: 12_000,
      contextLimit: 100_000,
      contextPercent: 12,
      messagesCount: 7,
      userCount: 3,
      assistantCount: 4,
      totalCost: 0.0123,
      costFormatted: '$0.0123',
    });
    expect(telemetry.rawMessages).toEqual([]);
  });

  test('a session that has not reported usage shows zero, never a fake split', () => {
    const telemetry = buildAcpTelemetry(
      { ...session, contextUsage: null, totalCost: 0, messageCount: 1, promptCount: 1, assistantCount: 0 },
      null,
    );
    expect(telemetry).toMatchObject({
      sessionTitle: 'Session',
      contextUsed: 0,
      contextLimit: 0,
      contextPercent: 0,
      totalCost: 0,
    });
    expect(telemetry.lastMessage.input).toBe(0);
    expect(telemetry.distribution.userTokens).toBe(0);
  });

  test('the last usage snapshot survives the process', async () => {
    await saveAcpUsage(session as AcpTelemetrySession);
    const stored = await loadAcpUsage('acp-1');
    expect(stored).toMatchObject({
      sessionId: 'acp-1',
      messageCount: 7,
      promptCount: 3,
      assistantCount: 4,
      contextUsage: { tokens: 12_000, contextWindow: 100_000, percent: 12 },
      totalCost: 0.0123,
      runModel: { provider: 'claude', modelId: 'opus' },
    });
  });
});
