/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The context panel's two reads for an ACP chat.
 *
 * An ACP agent writes no JSONL, so both endpoints used to fall through to the
 * omp-shaped estimator: the raw list invented a model id, a cwd and token
 * counts, and the summary invented a cost. These cases pin the real source —
 * the recorder's transcript and the agent's own `usage_update` — and the
 * absence of a fabricated field.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { loader as rawLoader } from '@/server/routes/telemetry/raw-messages';
import { loader as contextLoader } from '@/server/routes/telemetry/context';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import type { SessionContextTelemetry } from '@/shared/types';

const SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CWD = '/tmp/kabmo-acp-telemetry';

function args(path: string): LoaderFunctionArgs {
  return {
    params: {},
    request: new Request(`http://localhost${path}?sessionId=${SESSION}`),
  } as LoaderFunctionArgs;
}

beforeEach(async () => {
  await isolateDb();
  await saveHarnessSession({ sessionId: SESSION, harness: 'claude', agentSessionId: '', cwd: CWD });
  const db = await getDb();
  await db.run(
    'INSERT INTO acp_transcripts (session_id, messages, updated_at) VALUES (?, ?, ?)',
    [
      SESSION,
      JSON.stringify([
        { id: 'u1', role: 'user', content: 'hello', startedAt: 1_700_000_000_000 },
        {
          id: 'a1',
          role: 'assistant',
          content: 'done',
          model: 'claude/sonnet',
          startedAt: 1_700_000_001_000,
          usage: { input: 10, output: 5, totalTokens: 15 },
        },
      ]),
      Date.now(),
    ],
  );
  await db.run(
    `INSERT INTO harness_usage_state
       (session_id, used, size, cost, messages, prompts, assistants, model_provider, model_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [SESSION, 48_000, 1_000_000, 0.25, 2, 1, 1, 'claude', 'sonnet', Date.now()],
  );
});

afterAll(async () => {
  await releaseDb();
});

describe('GET /api/telemetry/raw-messages for an ACP chat', () => {
  test('reads the recorder transcript and states only what the rows hold', async () => {
    const response = await rawLoader(args('/api/telemetry/raw-messages'));
    const data = (await response.json()) as {
      source: string;
      total: number;
      items: { info: { modelID: string; path?: { cwd: string }; tokens: { input: number } }; rawPayload: unknown }[];
    };

    expect(data.source).toBe('acp-transcript');
    expect(data.total).toBe(2);
    const assistant = data.items.find((item) => item.info.modelID === 'claude/sonnet');
    expect(assistant).toBeDefined();
    expect(assistant?.info.path?.cwd).toBe(CWD);
    expect(assistant?.info.tokens.input).toBe(10);
    // The user row carries no usage: zero, never an estimate.
    const user = data.items.find((item) => item.info.modelID === 'claude/sonnet' && item.info.tokens.input === 0);
    expect(user).toBeDefined();
    expect(assistant?.rawPayload).toHaveProperty('role', 'assistant');
  });

  test('prefers the original ACP frames over the folded transcript', async () => {
    const db = await getDb();
    await db.run(
      'INSERT INTO acp_frames (session_id, method, kind, role, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        SESSION,
        'session/update',
        'agent_message_chunk',
        'assistant',
        JSON.stringify({
          sessionId: SESSION,
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'raw from acp' } },
        }),
        Date.now(),
      ],
    );

    const response = await rawLoader(args('/api/telemetry/raw-messages'));
    const data = (await response.json()) as {
      source: string;
      total: number;
      items: { type: string; rawPayload: { update?: { sessionUpdate?: string } } }[];
    };

    expect(data.source).toBe('acp-frames');
    expect(data.total).toBe(1);
    expect(data.items[0].type).toBe('agent_message_chunk');
    expect(data.items[0].rawPayload.update?.sessionUpdate).toBe('agent_message_chunk');
  });
});

describe('GET /api/telemetry/context for an ACP chat', () => {
  test('reports the agent usage instead of an estimate', async () => {
    const response = await contextLoader(args('/api/telemetry/context'));
    const data = (await response.json()) as { source: string; telemetry: SessionContextTelemetry };

    expect(data.source).toBe('acp-usage');
    expect(data.telemetry.contextUsed).toBe(48_000);
    expect(data.telemetry.contextLimit).toBe(1_000_000);
    expect(data.telemetry.messagesCount).toBe(2);
    expect(data.telemetry.modelId).toBe('claude/sonnet');
    expect(data.telemetry.costFormatted).toBe('$0.2500');
    expect(data.telemetry.rawMessages).toEqual([]);
  });

  test('a chat with no reported usage still counts its turns', async () => {
    const db = await getDb();
    await db.run('DELETE FROM harness_usage_state WHERE session_id = ?', [SESSION]);

    const response = await contextLoader(args('/api/telemetry/context'));
    const data = (await response.json()) as { source: string; telemetry: SessionContextTelemetry };

    expect(data.source).toBe('acp-transcript');
    expect(data.telemetry.messagesCount).toBe(2);
    expect(data.telemetry.userCount).toBe(1);
    expect(data.telemetry.assistantCount).toBe(1);
    expect(data.telemetry.contextUsed).toBe(0);
    expect(data.telemetry.modelId).toBe('claude/sonnet');
  });
});
