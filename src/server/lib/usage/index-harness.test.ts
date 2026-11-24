/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness dimension end to end: omp's JSONL and ACP stores in one index,
 * one filter, and no double count.
 *
 * The filter's options are built from the PERIOD and ignore the selection, so
 * the chip the user is looking at cannot disappear when they click it. Every
 * store is a temp tree; the suites above cover each parser on its own.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import { getDb } from '@/server/db.server';
import { buildTokenUsagePayload } from '@/server/lib/usage/index-query.server';
import { saveHarnessSession } from '@/server/lib/harness/session-store.server';

const dirs: string[] = [];
const saved = {
  agent: Bun.env.PI_CODING_AGENT_DIR,
  root: Bun.env.KABMO_USAGE_ACP_ROOT,
  claude: Bun.env.CLAUDE_CONFIG_DIR,
  codex: Bun.env.CODEX_HOME,
};

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete Bun.env[name];
  else Bun.env[name] = value;
}

const ompLine = (provider: string, model: string, cost: number): string => JSON.stringify({
  type: 'message',
  timestamp: '2026-11-20T10:00:00.000Z',
  message: {
    role: 'assistant',
    provider,
    model,
    usage: { input: 10, output: 5, cacheRead: 100, totalTokens: 115, cost: { total: cost } },
  },
});

beforeAll(async () => {
  await isolateDb();
  const root = tempDir('kabmo-harness-sources-');
  Bun.env.KABMO_USAGE_ACP_ROOT = root;

  const agent = path.join(tempDir('kabmo-harness-omp-'), 'agent');
  Bun.env.PI_CODING_AGENT_DIR = agent;
  fs.mkdirSync(path.join(agent, 'sessions', 'kabmo'), { recursive: true });
  fs.writeFileSync(path.join(agent, 'sessions', 'kabmo', 'rpc.jsonl'), `${ompLine('kenari', 'deepseek-v4', 2)}\n`);
  fs.writeFileSync(path.join(agent, 'sessions', 'kabmo', 'acp.jsonl'), `${ompLine('kenari', 'deepseek-v4', 3)}\n`);
  await saveHarnessSession({ sessionId: 'acp', harness: 'omp-acp', agentSessionId: '', cwd: '/tmp/kabmo' });

  Bun.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  const claudeDir = path.join(Bun.env.CLAUDE_CONFIG_DIR, 'projects', '-tmp-kabmo');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'c.jsonl'), [
    JSON.stringify({
      type: 'assistant',
      uuid: 'c1',
      timestamp: '2026-11-20T11:00:00.000Z',
      cwd: '/tmp/kabmo',
      message: {
        id: 'c1',
        model: 'sonnet',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }),
    JSON.stringify({ type: 'cost-state', startTime: Date.parse('2026-11-20T11:00:00.000Z'), modelUsage: { sonnet: { costUSD: 0.5 } } }),
  ].join('\n') + '\n');

  Bun.env.CODEX_HOME = path.join(root, 'codex');
  const codexDir = path.join(Bun.env.CODEX_HOME, 'sessions', '2026', '11', '20');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, 'rollout-2026-11-20T12-00-00-x.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { cwd: '/tmp/kabmo', model_provider: 'openai' } }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6.1-sol' } }),
    JSON.stringify({
      timestamp: '2026-11-20T12:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 8, cached_input_tokens: 0, output_tokens: 2, total_tokens: 10 } } },
    }),
  ].join('\n') + '\n');
});

afterAll(async () => {
  restore('PI_CODING_AGENT_DIR', saved.agent);
  restore('KABMO_USAGE_ACP_ROOT', saved.root);
  restore('CLAUDE_CONFIG_DIR', saved.claude);
  restore('CODEX_HOME', saved.codex);
  await releaseDb();
  for (const dir of dirs.splice(0)) removeDir(dir);
});

describe('harness-aware token usage', () => {
  test('attributes omp-rpc, omp-acp and the ACP stores separately', async () => {
    const payload = await buildTokenUsagePayload({
      range: 'all',
      now: new Date(2026, 10, 21, 12).getTime(),
      wait: true,
      force: true,
    });
    expect(payload.harnesses.map((row) => row.id).sort()).toEqual(['claude', 'codex', 'omp-acp', 'omp-rpc']);
    expect(payload.harnesses.find((row) => row.id === 'omp-rpc')?.cost).toBe(2);
    expect(payload.harnesses.find((row) => row.id === 'omp-acp')?.cost).toBe(3);
    expect(payload.harnesses.find((row) => row.id === 'claude')?.cost).toBe(0.5);
    expect(payload.harnesses.find((row) => row.id === 'codex')?.records).toBe(1);
  });

  test('filters every figure to the selected harness', async () => {
    const payload = await buildTokenUsagePayload({
      range: 'all',
      harness: 'claude',
      now: new Date(2026, 10, 21, 12).getTime(),
      wait: true,
      force: true,
    });
    expect(payload.harness).toBe('claude');
    expect(payload.totals.cost).toBe(0.5);
    expect(payload.totals.records).toBe(1);
    expect(payload.providers.map((row) => row.id)).toEqual(['claude']);
    // The options still name every harness, so the selected chip does not
    // vanish under the user's cursor.
    expect(payload.harnesses.map((row) => row.id).sort()).toEqual(['claude', 'codex', 'omp-acp', 'omp-rpc']);
  });

  test('keeps an ACP file row out of the omp-rpc bucket', async () => {
    const db = await getDb();
    const rows = await db.all<{ harness: string }>(
      "SELECT harness FROM usage_rollup WHERE session_file LIKE '%acp.jsonl'",
    );
    expect(rows).toEqual([{ harness: 'omp-acp' }]);
  });

  test('re-attributes an unchanged transcript when harness_sessions changes', async () => {
    await saveHarnessSession({ sessionId: 'rpc', harness: 'omp-acp', agentSessionId: '', cwd: '/tmp/kabmo' });
    const payload = await buildTokenUsagePayload({
      range: 'all',
      now: new Date(2026, 10, 21, 12).getTime(),
      wait: true,
      force: true,
    });
    // The file's stat did not change; only its harness row did. The index must
    // notice, or the filter reports the old transport forever.
    expect(payload.harnesses.find((row) => row.id === 'omp-rpc')).toBeUndefined();
    expect(payload.harnesses.find((row) => row.id === 'omp-acp')?.cost).toBe(5);
  });
});
