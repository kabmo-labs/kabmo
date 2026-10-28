/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';

import { computeRealSessionTelemetry } from '@/server/lib/omp/session/telemetry';

const tempDirs: string[] = [];

async function writeSession(records: unknown[]): Promise<string> {
  const dir = await fs.promises.mkdtemp('omp-telemetry-');
  tempDirs.push(dir);
  const file = `${dir}/session.jsonl`;
  await Bun.write(file, records.map((record) => JSON.stringify(record)).join('\n'));
  return file;
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const header = {
  type: 'session',
  id: 'ses_telemetry',
  cwd: '/tmp/project',
  timestamp: '2026-09-16T02:31:04.338Z',
};

function userMessage(id: string, text: string): Record<string, unknown> {
  return {
    type: 'message',
    id,
    timestamp: '2026-09-16T02:31:30.000Z',
    message: { role: 'user', content: text },
  };
}

function assistantMessage(id: string, message: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'message',
    id,
    timestamp: '2026-09-16T02:32:00.000Z',
    message: {
      role: 'assistant',
      provider: 'anthropic',
      model: '',
      content: [{ type: 'text', text: 'ok' }],
      ...message,
    },
  };
}

describe('computeRealSessionTelemetry context anchor', () => {
  test('uses the latest assistant anchor, never cumulative totalTokens', async () => {
    const file = await writeSession([
      header,
      userMessage('u1', 'first turn'),
      assistantMessage('a1', {
        usage: { input: 900, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 1_000_000 },
        contextSnapshot: { promptTokens: 2000, nonMessageTokens: 10 },
      }),
      userMessage('u2', 'second turn'),
      assistantMessage('a2', {
        usage: { input: 950, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 2_000_000 },
        contextSnapshot: { promptTokens: 3000, nonMessageTokens: 10 },
      }),
    ]);

    const telemetry = await computeRealSessionTelemetry(file, 'ses_telemetry');
    expect(telemetry.contextUsed).toBe(3000);
    expect(telemetry.contextPercent).toBe(0.3);
  });

  test('subtracts historyRewriteTokensRemoved from the anchor snapshot', async () => {
    const file = await writeSession([
      header,
      userMessage('u1', 'rewritten turn'),
      assistantMessage('a1', {
        usage: { input: 5000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 5010 },
        contextSnapshot: { promptTokens: 5000, nonMessageTokens: 10, historyRewriteTokensRemoved: 1200 },
      }),
    ]);

    const telemetry = await computeRealSessionTelemetry(file, 'ses_telemetry');
    expect(telemetry.contextUsed).toBe(3800);
  });

  test('falls back to usage.contextTokens when no snapshot exists', async () => {
    const file = await writeSession([
      header,
      userMessage('u1', 'context tokens'),
      assistantMessage('a1', {
        usage: { input: 100, output: 50, cacheRead: 100, cacheWrite: 0, totalTokens: 250, contextTokens: 4000 },
      }),
    ]);

    const telemetry = await computeRealSessionTelemetry(file, 'ses_telemetry');
    expect(telemetry.contextUsed).toBe(4000);
  });

  test('falls back to input + cacheRead + cacheWrite when contextTokens is absent', async () => {
    const file = await writeSession([
      header,
      userMessage('u1', 'prompt sum'),
      assistantMessage('a1', {
        usage: { input: 1000, output: 10, cacheRead: 500, cacheWrite: 250, totalTokens: 1760 },
      }),
    ]);

    const telemetry = await computeRealSessionTelemetry(file, 'ses_telemetry');
    expect(telemetry.contextUsed).toBe(1750);
  });

  test('sets distribution.otherTokens to cumulative cacheRead and keeps aggregate stats', async () => {
    const file = await writeSession([
      header,
      userMessage('u1', 'first turn'),
      assistantMessage('a1', {
        usage: {
          input: 1000,
          output: 100,
          cacheRead: 100,
          cacheWrite: 20,
          totalTokens: 1220,
          cost: { total: 0.01, input: 0.005, output: 0.003, cacheRead: 0.001, cacheWrite: 0.001 },
        },
        contextSnapshot: { promptTokens: 1100, nonMessageTokens: 10 },
      }),
      userMessage('u2', 'second turn'),
      assistantMessage('a2', {
        usage: {
          input: 2000,
          output: 200,
          cacheRead: 250,
          cacheWrite: 30,
          totalTokens: 2480,
          cost: { total: 0.02, input: 0.01, output: 0.006, cacheRead: 0.002, cacheWrite: 0.002 },
        },
        contextSnapshot: { promptTokens: 2200, nonMessageTokens: 10 },
      }),
    ]);

    const telemetry = await computeRealSessionTelemetry(file, 'ses_telemetry');
    expect(telemetry.distribution.userTokens).toBe(3000);
    expect(telemetry.distribution.assistantTokens).toBe(300);
    expect(telemetry.distribution.toolTokens).toBe(50);
    expect(telemetry.distribution.otherTokens).toBe(350);
    expect(telemetry.totalCost).toBeCloseTo(0.03, 5);
    expect(telemetry.contextUsed).toBe(2200);
  });
});

describe('computeRealSessionTelemetry raw items', () => {
  // The default is the TELEMETRY TOPIC's payload, which the navbar ring keeps
  // subscribed for every open session and the server republishes on every tool
  // call. A raw item carries its whole entry as `rawPayload`, so reading 0 as
  // "unlimited" put the entire transcript on that topic — measured 690 KB of a
  // 691 KB snapshot on a 111-message session.
  test('materializes no raw items by default', async () => {
    const file = await writeSession([
      header,
      userMessage('u1', 'first turn'),
      assistantMessage('a1', { usage: { input: 10, output: 5 } }),
      userMessage('u2', 'second turn'),
      assistantMessage('a2', { usage: { input: 20, output: 5 } }),
    ]);
    const telemetry = await computeRealSessionTelemetry(file, 'ses_telemetry');
    expect(telemetry.messagesCount).toBe(4);
    expect(telemetry.rawMessages).toEqual([]);
  });

  test('caps raw items at a positive limit', async () => {
    const file = await writeSession([
      header,
      userMessage('u1', 'first turn'),
      assistantMessage('a1', { usage: { input: 10, output: 5 } }),
      userMessage('u2', 'second turn'),
      assistantMessage('a2', { usage: { input: 20, output: 5 } }),
    ]);
    const telemetry = await computeRealSessionTelemetry(file, 'ses_telemetry', undefined, 2);
    expect(telemetry.rawMessages).toHaveLength(2);
    expect(telemetry.rawMessages[0]?.id).toBe('u1');
  });
});
