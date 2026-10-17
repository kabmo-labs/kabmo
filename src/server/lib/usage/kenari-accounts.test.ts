/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Two Kenari accounts must stay two providers, end to end.
 *
 * A Kenari provider is identified by name/slug/endpoint, and both accounts
 * share the same upstream host — so the credential is the only thing that
 * separates them. Before the fix `kenari2` merged into `kenari`'s settings row
 * and its key was never read: the usage card showed one account's quota under
 * whichever name the merge kept.
 *
 * These tests drive the real aggregator against a stub agent and stub
 * endpoints, so the gate (`kenariProviderSlugs`), the per-slug report and the
 * request headers are exercised together rather than one at a time.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { executableStub, OMP_RPC_STUB_SOURCE } from '@/test-support/executable-stub';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb } from '@/server/db.server';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { disposeUtilityRpc } from '@/server/lib/omp/rpc/utility';
import { invalidateUsageCache } from '@/server/lib/usage/omp-usage.server';
import { buildUsageProviders } from '@/server/lib/usage/providers.server';
import { removeDir } from '@/test-support/remove-dir';

/** The runner's own fetch, reached through `Bun` so a leaked stub is visible. */
const realFetch = Bun.fetch;
const calls: Array<{ url: string; auth: string | null }> = [];

/**
 * A stub agent. `usage --json` is spawned directly with that argv, so the stub
 * has to answer it on stdout; every other command arrives as an RPC frame. It
 * extends the shared RPC responder with that one direct-argv answer.
 */
const STUB_SOURCE = OMP_RPC_STUB_SOURCE.replace(
  '#!/usr/bin/env bun\n',
  `const args = process.argv.slice(2);
if (args.includes('usage')) {
  process.stdout.write(JSON.stringify({ reports: [], accountsWithoutUsage: [] }));
  process.exit(0);
}
`,
);

const dirs: string[] = [];
let agentDir = '';
let stubBin = '';
let realAgentDir: string | undefined;
let realBin: string | undefined;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ompchamber-test-'));
  dirs.push(dir);
  return dir;
}

/** A JSON-RPC `tools/call` result carrying one text content item. */
function toolResponse(text: string): Response {
  return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } });
}

beforeAll(async () => {
  agentDir = tempDir();
  // A COMPILED executable, not a `#!/bin/sh` script: `Bun.spawn` on Windows
  // resolves only `.com`/`.exe` through libuv's `search_path`, so a shebang
  // script is unspawnable there however it is chmod-ed.
  stubBin = await executableStub(STUB_SOURCE, 'fake-omp');
  realAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  realBin = Bun.env.OMPCHAMBER_OMP_BIN;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  Bun.env.OMPCHAMBER_OMP_BIN = stubBin;
  Bun.env.FAKE_OMP_RESPONSES = JSON.stringify({
    get_login_providers: { providers: [] },
    get_available_models: { models: [] },
  });
  invalidateOmpCliCache();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ url, auth });
    if (url.includes('/v1/account/quota')) {
      return Response.json({ plan: { name: auth === 'Bearer first-key' ? 'First Plan' : 'Second Plan' } });
    }
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const tool = (body as { params?: { name?: string } } | null)?.params?.name;
    if (tool === 'kenari_balance') return toolResponse(`Balance: Rp ${auth === 'Bearer first-key' ? 1000 : 2000}`);
    if (tool === 'kenari_usage') return toolResponse('');
    throw new Error(`unexpected request to ${url}`);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  disposeUtilityRpc();
  if (realAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = realAgentDir;
  if (realBin === undefined) delete Bun.env.OMPCHAMBER_OMP_BIN;
  else Bun.env.OMPCHAMBER_OMP_BIN = realBin;
  delete Bun.env.FAKE_OMP_RESPONSES;
  invalidateOmpCliCache();
  for (const dir of dirs.splice(0)) removeDir(dir);
});

afterEach(() => {
  calls.length = 0;
  invalidateUsageCache();
  disposeUtilityRpc();
  globalThis.__ompChamberDb?.resolved?.raw.close();
  globalThis.__ompChamberDb = undefined;
  delete Bun.env.OMPCHAMBER_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
  delete Bun.env.MOCK;
});

/** Two accounts, same endpoint, different keys — the case that used to collapse. */
async function seedTwoKenariAccounts(): Promise<void> {
  Bun.env.OMPCHAMBER_DB_PATH = join(tempDir(), 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__ompChamberDb = undefined;
  const db = await getDb();
  await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
    'omp_providers_config',
    JSON.stringify([
      { name: 'Kenari', slug: 'kenari', baseUrl: 'https://kenari.id/v1', apiKey: 'first-key' },
      { name: 'Kenari 2', slug: 'kenari2', baseUrl: 'https://kenari.id/v1', apiKey: 'second-key' },
    ]),
  ]);
}

describe('two Kenari accounts', () => {
  test('each keeps its own row, its own key and its own report', async () => {
    await seedTwoKenariAccounts();

    const providers = await buildUsageProviders();
    const first = providers.find((provider) => provider.id === 'kenari');
    const second = providers.find((provider) => provider.id === 'kenari2');

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Each report reflects the account whose key was sent.
    expect(first?.kenari?.quota?.planName).toBe('First Plan');
    expect(second?.kenari?.quota?.planName).toBe('Second Plan');
    expect(first?.kenari?.balance?.amountRp).toBe(1000);
    expect(second?.kenari?.balance?.amountRp).toBe(2000);

    // Both accounts reach the upstream endpoint, each with its own key.
    const quotaKeys = calls
      .filter((call) => call.url.includes('/v1/account/quota'))
      .map((call) => call.auth)
      .sort();
    expect(quotaKeys).toEqual(['Bearer first-key', 'Bearer second-key']);
  });
});
