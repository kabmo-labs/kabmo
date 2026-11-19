/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The raw ACP frame log.
 *
 * The transcript is Kabmo's fold; the raw panel must show the original
 * `session/update` payloads. These cases pin the write path (batched, ordered),
 * the role mapping the panel filters on, and the page reader's `rawPayload`.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { AcpFrameRecorder, frameRole, loadAcpFramesPage } from '@/server/lib/harness/acp/acp-frames.server';

const SESSION = 'frame-session';

beforeEach(async () => {
  await isolateDb();
});

afterAll(async () => {
  await releaseDb();
});

describe('frameRole', () => {
  test('maps the message kinds the panel filters on', () => {
    expect(frameRole('user_message_chunk')).toBe('user');
    expect(frameRole('agent_message_chunk')).toBe('assistant');
    expect(frameRole('agent_thought_chunk')).toBe('assistant');
    expect(frameRole('tool_call')).toBe('assistant');
    expect(frameRole('usage_update')).toBe('system');
  });
});

describe('AcpFrameRecorder', () => {
  test('stores the original payload and pages it newest first', async () => {
    const recorder = new AcpFrameRecorder(() => SESSION);
    recorder.record('session/update', {
      sessionId: SESSION,
      update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hello' } },
    });
    recorder.record('session/update', {
      sessionId: SESSION,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi there' } },
    });
    recorder.record('session/update', {
      sessionId: SESSION,
      update: { sessionUpdate: 'usage_update', used: 1200, size: 200000, cost: { amount: 0.01, currency: 'USD' } },
    });
    await recorder.flush();

    const page = await loadAcpFramesPage(SESSION, 1, 10, 'all', { modelId: 'claude/sonnet', cwd: '/tmp/p' });
    expect(page.total).toBe(3);
    expect(page.filteredTotal).toBe(3);
    expect(page.items.map((item) => item.type)).toEqual(['usage_update', 'agent_message_chunk', 'user_message_chunk']);

    const usage = page.items[0];
    expect(usage.tokenSummary).toBe('1,200 / 200,000');
    expect(usage.info.cost).toBe(0.01);
    expect(usage.rawPayload).toEqual({
      sessionId: SESSION,
      update: { sessionUpdate: 'usage_update', used: 1200, size: 200000, cost: { amount: 0.01, currency: 'USD' } },
    });

    const assistant = page.items[1];
    expect(assistant.info.role).toBe('assistant');
    expect(assistant.info.modelID).toBe('claude/sonnet');
    expect(assistant.info.path).toEqual({ cwd: '/tmp/p', root: '/tmp/p' });
    expect(assistant.badgeLabel).toBe('agent_message_chunk: hi there');
  });

  test('filters by role and pages without re-reading the payloads', async () => {
    const recorder = new AcpFrameRecorder(() => SESSION);
    for (let i = 0; i < 5; i += 1) {
      recorder.record('session/update', {
        sessionId: SESSION,
        update: { sessionUpdate: i % 2 === 0 ? 'user_message_chunk' : 'agent_message_chunk', content: { type: 'text', text: `m${i}` } },
      });
    }
    await recorder.flush();

    const users = await loadAcpFramesPage(SESSION, 1, 10, 'user');
    expect(users.total).toBe(5);
    expect(users.filteredTotal).toBe(3);
    expect(users.items.every((item) => item.info.role === 'user')).toBe(true);

    const second = await loadAcpFramesPage(SESSION, 2, 2, 'all');
    expect(second.items).toHaveLength(2);
    expect(second.items.map((item) => item.type)).toEqual(['user_message_chunk', 'agent_message_chunk']);
  });

  test('a dispose flushes the buffered frames', async () => {
    const recorder = new AcpFrameRecorder(() => SESSION);
    recorder.record('session/update', {
      sessionId: SESSION,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'last' } },
    });
    await recorder.dispose();
    const page = await loadAcpFramesPage(SESSION, 1, 10, 'all');
    expect(page.total).toBe(1);
  });
});
