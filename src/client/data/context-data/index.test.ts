/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { computeSessionContextTelemetry } from '@/client/data/context-data';

const CONTEXT_LIMIT = 1_000_000;

interface MockMessage {
  id: string;
  role: string;
  content: string;
  date: string;
}

function userMessage(id: string, content: string): MockMessage {
  return { id, role: 'user', content, date: '9/16, 10:00 AM' };
}

function assistantMessage(id: string, content: string): MockMessage {
  return { id, role: 'ai', content, date: '9/16, 10:01 AM' };
}

function assistantAnchors(telemetry: ReturnType<typeof computeSessionContextTelemetry>) {
  return telemetry.rawMessages
    .filter((m) => m.info.role === 'assistant')
    .map((m) => ({
      anchor: m.info.tokens.input + m.info.tokens.cache.read + m.info.tokens.cache.write,
      cacheRead: m.info.tokens.cache.read,
      total: m.info.tokens.total,
    }));
}

describe('computeSessionContextTelemetry context anchor', () => {
  test('contextUsed is the latest assistant prompt estimate, not cumulative session totals', () => {
    const telemetry = computeSessionContextTelemetry('ses_anchor', 'Anchor Session', [
      userMessage('u1', 'first question'),
      assistantMessage('a1', 'first answer'),
      userMessage('u2', 'second question'),
      assistantMessage('a2', 'second answer that is considerably longer'),
    ]);

    const anchors = assistantAnchors(telemetry);
    const latest = anchors[anchors.length - 1];
    const cumulative = anchors.reduce((sum, a) => sum + a.total, 0);

    expect(latest).toBeDefined();
    expect(telemetry.contextUsed).toBe(latest.anchor);
    expect(telemetry.contextUsed).toBeLessThan(cumulative);
  });

  test('distribution.otherTokens is the cumulative cacheRead across the session', () => {
    const telemetry = computeSessionContextTelemetry('ses_other', 'Other Session', [
      userMessage('u1', 'first question'),
      assistantMessage('a1', 'first answer'),
      userMessage('u2', 'second question'),
      assistantMessage('a2', 'second answer that is considerably longer'),
    ]);

    const cumulativeCacheRead = assistantAnchors(telemetry).reduce((sum, a) => sum + a.cacheRead, 0);

    expect(cumulativeCacheRead).toBeGreaterThan(0);
    expect(telemetry.distribution.otherTokens).toBe(cumulativeCacheRead);
  });

  test('fabricates no occupancy when the session has no assistant messages', () => {
    const telemetry = computeSessionContextTelemetry('ses_user_only', 'User Only', [
      userMessage('u1', 'a question with no answer yet'),
    ]);

    expect(telemetry.contextUsed).toBe(0);
    expect(telemetry.contextPercent).toBe(0);
  });

  test('derives contextPercent from the anchor and clamps it to [0, 100]', () => {
    const telemetry = computeSessionContextTelemetry('ses_clamp', 'Clamp Session', [
      userMessage('u1', 'one very large prompt'),
      assistantMessage('a1', 'x'.repeat(120_000)),
    ]);

    expect(telemetry.contextUsed).toBeGreaterThan(CONTEXT_LIMIT);
    expect(telemetry.contextPercent).toBe(100);
    expect(telemetry.contextPercent).toBeGreaterThanOrEqual(0);
    expect(telemetry.contextPercent).toBeLessThanOrEqual(100);
  });
});

/**
 * The window a session reports belongs to the model that will run its turns.
 * A session with no message yet still has one — the model the user picked —
 * and rendering it against the 1M constant made a 256K model read as 8% of a
 * window it does not have.
 */
describe('computeSessionContextTelemetry selected-model context limit', () => {
  test('an empty session carries the caller\'s limit, not the 1M default', () => {
    const telemetry = computeSessionContextTelemetry('ses_empty', 'Empty', [], 256_000);
    expect(telemetry.contextLimit).toBe(256_000);
    expect(telemetry.messagesCount).toBe(0);
  });

  test('a populated session divides by the caller\'s limit', () => {
    const telemetry = computeSessionContextTelemetry('ses_lim', 'Limit', [
      userMessage('u1', 'question'),
      assistantMessage('a1', 'answer'),
    ], 256_000);

    expect(telemetry.contextLimit).toBe(256_000);
    expect(telemetry.contextPercent).toBeCloseTo(
      Number(((telemetry.contextUsed / 256_000) * 100).toFixed(1)),
      5,
    );
  });

  test('omitting the limit keeps the historical constant', () => {
    const telemetry = computeSessionContextTelemetry('ses_default', 'Default', []);
    expect(telemetry.contextLimit).toBe(CONTEXT_LIMIT);
  });
});
