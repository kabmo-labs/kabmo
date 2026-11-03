/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET|POST /api/telemetry/tokens` — the contract the Token Usage panel reads.
 *
 * The route is small on purpose, so the cases that matter are the ones a user
 * can see: an unknown period must not 400 (the picker's own state can outrun a
 * deploy), the body must carry the provider split the breakdown draws, and a
 * demo run must answer the SAME shape as a real one — a field present in only
 * one mode is how the panel renders in dev and crashes in production.
 *
 * The sessions root is a temp tree and the DB a temp file, so nothing here can
 * read the developer's own usage.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import { action, loader } from '@/server/routes/telemetry/tokens';
import type { TokenUsagePayload } from '@/shared/types';

const dirs: string[] = [];
let savedAgentDir: string | undefined;
let sessionsRoot = '';

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-tokens-'));
  dirs.push(dir);
  return dir;
}

async function read(response: Response): Promise<TokenUsagePayload> {
  return (await response.json()) as TokenUsagePayload;
}

/** The route modules answer `unknown` (Remix's loader contract); this names it. */
async function call(
  handler: (args: never) => unknown,
  request: Request,
): Promise<Response> {
  return (await handler({ request } as never)) as Response;
}

const line = (provider: string, model: string, cost: number, timestamp: Date) =>
  JSON.stringify({
    type: 'message',
    timestamp: timestamp.toISOString(),
    message: {
      role: 'assistant',
      provider,
      model,
      usage: { input: 10, output: 5, cacheRead: 100, totalTokens: 115, cost: { total: cost } },
    },
  });

beforeAll(async () => {
  await isolateDb();
  savedAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  const agent = path.join(tempDir(), 'agent');
  Bun.env.PI_CODING_AGENT_DIR = agent;
  sessionsRoot = path.join(agent, 'sessions', 'kabmo');
  fs.mkdirSync(sessionsRoot, { recursive: true });
  delete Bun.env.MOCK;

  const now = new Date();
  fs.writeFileSync(
    path.join(sessionsRoot, 'a.jsonl'),
    [
      line('kenari-jatis', 'deepseek-v4-1-flash', 9, now),
      line('kenari', 'deepseek-v4-1-flash', 1, now),
    ].join('\n') + '\n',
  );
});

afterAll(async () => {
  if (savedAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = savedAgentDir;
  await releaseDb();
  for (const dir of dirs.splice(0)) removeDir(dir);
});

describe('GET /api/telemetry/tokens', () => {
  test('answers the provider split of the requested period', async () => {
    const response = await call(loader, new Request('http://kabmo.test/api/telemetry/tokens?range=30d'));
    expect(response.status).toBe(200);
    const payload = await read(response);
    expect(payload.providers.map((provider) => provider.id).sort()).toEqual(['kenari', 'kenari-jatis']);
    expect(payload.providers.find((provider) => provider.id === 'kenari-jatis')?.cost).toBeCloseTo(9, 10);
    expect(payload.days).toHaveLength(1);
    expect(payload.days[0].providers['kenari']?.cost).toBeCloseTo(1, 10);
  });

  test('the body is raw counters plus an index state — no formatted strings', async () => {
    const payload = await read(await call(loader, new Request('http://kabmo.test/api/telemetry/tokens')));
    expect(typeof payload.totals.cost).toBe('number');
    expect(payload.index.state).toBe('ready');
    expect(payload.index.transcripts).toBe(1);
    expect(payload.periodLabel.length).toBeGreaterThan(0);
  });

  test('an unknown range falls back to the default instead of failing', async () => {
    const payload = await read(await call(loader, new Request('http://kabmo.test/api/telemetry/tokens?range=forever')));
    expect(payload.range).toBe('30d');
  });

  test('a custom period is honoured end to end', async () => {
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const payload = await read(
      await call(loader, new Request(`http://kabmo.test/api/telemetry/tokens?range=custom&customFrom=${day}&customTo=${day}`)),
    );
    expect(payload.range).toBe('custom');
    expect(payload.totals.records).toBe(2);
  });

  test('a non-GET request is refused rather than answered', async () => {
    const response = await call(loader, new Request('http://kabmo.test/api/telemetry/tokens', { method: 'POST' }));
    expect(response.status).toBe(405);
  });
});

describe('POST /api/telemetry/tokens', () => {
  test('refresh re-reads the tree and answers the same shape', async () => {
    fs.appendFileSync(
      path.join(sessionsRoot, 'a.jsonl'),
      `${line('kenari-jatis', 'deepseek-v4-1-flash', 2, new Date())}\n`,
    );
    const response = await call(action, new Request('http://kabmo.test/api/telemetry/tokens?range=30d', { method: 'POST' }));
    expect(response.status).toBe(200);
    const payload = await read(response);
    expect(payload.providers.find((provider) => provider.id === 'kenari-jatis')?.cost).toBeCloseTo(11, 10);
  });

  test('a non-POST request is refused', async () => {
    const response = await call(action, new Request('http://kabmo.test/api/telemetry/tokens', { method: 'GET' }));
    expect(response.status).toBe(405);
  });
});
