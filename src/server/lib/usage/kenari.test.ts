/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `usage/kenari.ts` turns three very different upstream payloads — a REST quota
 * document, a JSON-RPC tool result, and a Markdown table delivered over SSE —
 * into the shape the Usage card renders. Each of these was a silent-wrong-data
 * risk:
 *
 *  - the quota windows are keyed by dialect names (`five_hour` / `week` /
 *    `month`) and a missing field must read as 0 rather than NaN;
 *  - a coupon's `remaining_rp` can be explicitly null, which means "unlimited",
 *    not "0";
 *  - the usage table's numbers carry thousands separators and its total line is
 *    the only source of the request count, so a mangled parse understates usage;
 *  - the MCP call must send an explicit User-Agent (Cloudflare answers 1010 to
 *    the default one) and must read either a JSON or an SSE body;
 *  - the three calls are independent: one failure must not lose the others.
 *
 * `fetch` is stubbed and the credential comes from a throwaway SQLite file, so
 * nothing leaves the machine.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb } from '@/server/db.server';
import { buildKenariReport } from '@/server/lib/usage/kenari';
import { removeDir } from '@/test-support/remove-dir';

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const realFetch = Bun.fetch;
const calls: Array<{ url: string; body: unknown; headers: Headers }> = [];
const handlers = {
  quota: () => Response.json({}),
  balance: () => toolResponse('Rp 0'),
  usage: () => toolResponse(''),
};

const dirs: string[] = [];
let realAgentDir: string | undefined;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ompchamber-test-'));
  dirs.push(dir);
  return dir;
}

/** A JSON-RPC `tools/call` result carrying one text content item. */
function toolResponse(text: string): Response {
  return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } });
}

beforeAll(() => {
  realAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  Bun.env.PI_CODING_AGENT_DIR = tempDir();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, body, headers: new Headers(init?.headers) });
    if (url.includes('/v1/account/quota')) return handlers.quota();
    const tool = (body as { params?: { name?: string } } | null)?.params?.name;
    if (tool === 'kenari_balance') return handlers.balance();
    if (tool === 'kenari_usage') return handlers.usage();
    throw new Error(`unexpected request to ${url}`);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  if (realAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = realAgentDir;
  for (const dir of dirs.splice(0)) removeDir(dir);
});

afterEach(() => {
  calls.length = 0;
  handlers.quota = () => Response.json({});
  handlers.balance = () => toolResponse('Rp 0');
  handlers.usage = () => toolResponse('');
  globalThis.__ompChamberDb?.resolved?.raw.close();
  globalThis.__ompChamberDb = undefined;
  delete Bun.env.OMPCHAMBER_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
});

/** Point the db singleton at a throwaway file and store one kenari credential. */
async function seedKenariCredential(apiKey = 'kenari-key'): Promise<void> {
  Bun.env.OMPCHAMBER_DB_PATH = join(tempDir(), 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__ompChamberDb = undefined;
  const db = await getDb();
  await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
    'omp_providers_config',
    JSON.stringify([{ name: 'Kenari', slug: 'kenari', baseUrl: 'https://kenari.id/v1', apiKey }]),
  ]);
}

const USAGE_TABLE = [
  '| model | requests | input | output | cost |',
  '| --- | --- | --- | --- | --- |',
  '| deepseek-v4 | 12 | 1.500 | 2.000 | Rp 12.500 |',
  '| gemini-2 | 3 | 100 | 200 | Rp 1.000 |',
  '',
  'Total: 15 requests · Rp 13.500',
].join('\n');

describe('buildKenariReport — payload shaping', () => {
  test('quota windows, coupon, balance and usage are all mapped', async () => {
    await seedKenariCredential();
    handlers.quota = () => Response.json({
      plan: {
        name: 'Pro',
        windows: {
          five_hour: { used_rp: 1500, remaining_rp: 8500, resets_at: '2026-10-01T10:00:00Z' },
          week: { used_rp: 20_000, remaining_rp: 30_000 },
          month: {},
        },
      },
      coupon: { name: 'PROMO', used_rp: 1000, remaining_rp: null, expires_at: '2026-12-01', scope_models: ['deepseek-v4', 7] },
    });
    handlers.balance = () => toolResponse('Balance: Rp 76.514');
    handlers.usage = () => toolResponse(USAGE_TABLE);

    const report = await buildKenariReport('kenari');
    expect(report?.error).toBeUndefined();
    expect(report?.quota).toEqual({
      planName: 'Pro',
      windows: [
        { key: 'five_hour', label: '5 hours', usedRp: 1500, remainingRp: 8500, resetsAt: '2026-10-01T10:00:00Z' },
        { key: 'week', label: 'Weekly', usedRp: 20_000, remainingRp: 30_000, resetsAt: '' },
        { key: 'month', label: 'Monthly', usedRp: 0, remainingRp: 0, resetsAt: '' },
      ],
      coupon: { name: 'PROMO', usedRp: 1000, remainingRp: null, expiresAt: '2026-12-01', scopeModels: ['deepseek-v4'] },
    });
    expect(report?.balance).toEqual({ amountRp: 76_514, raw: 'Balance: Rp 76.514' });
    expect(report?.usage?.rows).toEqual([
      { model: 'deepseek-v4', requests: 12, inputTokens: 1500, outputTokens: 2000, costRp: 12_500 },
      { model: 'gemini-2', requests: 3, inputTokens: 100, outputTokens: 200, costRp: 1000 },
    ]);
    expect(report?.usage?.totalRequests).toBe(15);
    expect(report?.usage?.totalCostRp).toBe(13_500);
    expect(report?.usage?.raw).toBe(USAGE_TABLE);
  });

  test('the MCP call announces an explicit User-Agent and the balance key', async () => {
    await seedKenariCredential('secret-key');
    handlers.balance = () => toolResponse('Rp 1');

    await buildKenariReport('kenari');
    const mcp = calls.find((call) => call.url.includes('/mcp'));
    expect(mcp?.headers.get('authorization')).toBe('Bearer secret-key');
    expect(mcp?.headers.get('user-agent')).toContain('ompchamber/');
    expect(mcp?.headers.get('accept')).toContain('text/event-stream');
  });

  test('a quota payload that is not an object is reported, not thrown', async () => {
    await seedKenariCredential();
    handlers.quota = () => Response.json([1, 2, 3]);
    handlers.balance = () => toolResponse('Rp 5');
    handlers.usage = () => toolResponse(USAGE_TABLE);

    const report = await buildKenariReport('kenari');
    expect(report?.quota).toBeUndefined();
    expect(report?.error).toBe('Unexpected quota response format');
    expect(report?.balance).toEqual({ amountRp: 5, raw: 'Rp 5' });
    expect(report?.usage?.totalRequests).toBe(15);
  });

  test('a shared key is refused with the owner-key explanation', async () => {
    await seedKenariCredential();
    handlers.quota = () => Response.json({ code: 'shared_key_not_allowed' }, { status: 403 });

    const report = await buildKenariReport('kenari');
    expect(report?.error).toContain('shared key');
    expect(report?.quota).toBeUndefined();
  });

  test('a JSON-RPC error message is surfaced', async () => {
    await seedKenariCredential();
    handlers.usage = () => Response.json({ jsonrpc: '2.0', id: 1, error: { message: 'quota exhausted' } });

    const report = await buildKenariReport('kenari');
    expect(report?.error).toContain('quota exhausted');
    expect(report?.usage).toBeUndefined();
  });

  test('an SSE body is decoded, skipping malformed and [DONE] data lines', async () => {
    await seedKenariCredential();
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: USAGE_TABLE }] } });
    handlers.usage = () => new Response(
      `data: not json\n\ndata: [DONE]\n\ndata: ${payload}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    );

    const report = await buildKenariReport('kenari');
    expect(report?.usage?.rows.map((row) => row.model)).toEqual(['deepseek-v4', 'gemini-2']);
  });

  test('a non-2xx MCP response is reported with its status', async () => {
    await seedKenariCredential();
    handlers.balance = () => new Response('boom', { status: 500 });

    const report = await buildKenariReport('kenari');
    expect(report?.error).toBe('HTTP 500');
    expect(report?.balance).toBeUndefined();
  });

  test('a Rupiah decimal amount parses with comma as the decimal separator', async () => {
    await seedKenariCredential();
    handlers.balance = () => toolResponse('Rp 1.234,56');

    const report = await buildKenariReport('kenari');
    expect(report?.balance?.amountRp).toBe(1234.56);
  });

  test('a balance with no Rupiah amount keeps the raw text and a null amount', async () => {
    await seedKenariCredential();
    handlers.balance = () => toolResponse('unavailable');

    const report = await buildKenariReport('kenari');
    expect(report?.balance).toEqual({ amountRp: null, raw: 'unavailable' });
  });

  test('a usage table without a total line reports zero totals', async () => {
    await seedKenariCredential();
    handlers.usage = () => toolResponse('| model | requests | input | output | cost |\n| a | 1 | 2 | 3 | Rp 4 |');

    const report = await buildKenariReport('kenari');
    expect(report?.usage?.rows).toHaveLength(1);
    expect(report?.usage?.totalRequests).toBe(0);
    expect(report?.usage?.totalCostRp).toBe(0);
  });
});

describe('buildKenariReport — credential gate', () => {
  test('no kenari credential means no report and no upstream call', async () => {
    Bun.env.OMPCHAMBER_DB_PATH = join(tempDir(), 'db.sqlite');
    Bun.env.SYNC_WORKSPACE = 'false';
    delete Bun.env.MOCK;
    globalThis.__ompChamberDb = undefined;

    expect(await buildKenariReport('kenari')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('a masked placeholder key is not a credential', async () => {
    await seedKenariCredential('••••••••');

    expect(await buildKenariReport('kenari')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
