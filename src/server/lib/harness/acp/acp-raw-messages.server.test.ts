/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP raw-message rows state what the transcript holds.
 *
 * The omp-shaped estimator this replaces invented a model id, a cwd and token
 * counts from character lengths, so an opencode chat's raw panel claimed
 * `deepseek/deepseek-v4-flash` and a `/Users/…/Workspace` path the agent never
 * sent. These cases pin the honest fields: the row's own usage when present,
 * zeros when not, and the row itself as `rawPayload`.
 */

import { describe, expect, test } from 'bun:test';
import { buildAcpRawMessages } from '@/server/lib/harness/acp/acp-raw-messages.server';
import type { ChatMessageData } from '@kabmo-labs/kabmo-chat-contracts/chat';

const user: ChatMessageData = {
  id: 'u1',
  role: 'user',
  content: 'hello there',
  startedAt: 1_700_000_000_000,
};

const assistant: ChatMessageData = {
  id: 'a1',
  role: 'assistant',
  content: 'done',
  model: 'opencode/hy4-flash-free',
  startedAt: 1_700_000_001_000,
  usage: { input: 120, output: 30, cacheRead: 10, totalTokens: 160, cost: { total: 0.002 } },
  toolCalls: [{ id: 't1', type: 'bash', title: 'Run', name: 'bash' }],
};

describe('buildAcpRawMessages', () => {
  test('keeps the row model and usage, and never invents a token count', () => {
    const [first, second] = buildAcpRawMessages([user, assistant], { cwd: '/tmp/project' });

    expect(first.info.modelID).toBe('');
    expect(first.info.tokens).toEqual({ total: 0, input: 0, output: 0, reasoning: 0, cache: { write: 0, read: 0 } });
    expect(first.tokenSummary).toBe('');
    expect(first.info.path).toEqual({ cwd: '/tmp/project', root: '/tmp/project' });

    expect(second.info.modelID).toBe('opencode/hy4-flash-free');
    expect(second.info.tokens).toEqual({ total: 160, input: 120, output: 30, reasoning: 0, cache: { write: 0, read: 10 } });
    expect(second.info.cost).toBe(0.002);
    expect(second.tokenSummary).toBe('120 / 30');
    expect(second.badgeLabel).toBe('text + bash');
  });

  test('the raw payload is the stored row, not a synthesized omp entry', () => {
    const [row] = buildAcpRawMessages([assistant]);
    expect(row.rawPayload).toBe(assistant);
    expect(row.rawPayload).not.toHaveProperty('info');
  });

  test('a row with no clock and no cwd leaves both empty', () => {
    const [row] = buildAcpRawMessages([{ id: 'x', role: 'assistant', content: 'hi' }]);
    expect(row.timestamp).toBe('');
    expect(row.info.path).toBeUndefined();
  });

  test('the context model fills a row that did not record one', () => {
    const [row] = buildAcpRawMessages([user], { modelId: 'claude/sonnet' });
    expect(row.info.modelID).toBe('claude/sonnet');
  });
});
