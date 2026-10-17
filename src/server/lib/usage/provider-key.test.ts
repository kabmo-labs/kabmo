/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `usage/provider-key.ts` answers "which providers may the usage UI show, and
 * where did each key come from". Getting it wrong shows a provider with no
 * usable credential (a dead card) or hides one omp happily runs on. The rules
 * pinned here:
 *
 *  - a masked placeholder (`••••••`) in the chamber overlay is NOT a credential;
 *  - the overlay, omp's models.yml and omp's agent.db are merged, not
 *    overridden — a slug in two stores reports both sources;
 *  - a provider omp resolves but no store accounts for is `environment` (an
 *    `ANTHROPIC_API_KEY`-style variable omp's own credential check sees);
 *  - key resolution prefers the overlay, then omp's own stores;
 *  - the result never carries key material.
 *
 * Both omp stores are redirected to a temp agent dir, the app DB to a temp
 * file, and the omp registry view to a stub binary — so the real user
 * credentials and the real agent are never touched.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { ompRpcStub } from '@/test-support/executable-stub';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb } from '@/server/db.server';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { disposeUtilityRpc } from '@/server/lib/omp/rpc/utility';
import { kenariProviderSlugs, listCredentialedProviders, loadProviderEntries, resolveDeepSeekApiKey, resolveKenariApiKey } from '@/server/lib/usage/provider-key';
import { removeDir } from '@/test-support/remove-dir';

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

beforeAll(async () => {
  agentDir = tempDir();
  // A COMPILED executable, not a `#!/bin/sh` script: `Bun.spawn` on Windows
  // resolves only `.com`/`.exe` through libuv's `search_path`, so a shebang
  // script is unspawnable there however it is chmod-ed — which is why this suite
  // used to be skipped on Windows. The compiled stub is a real program on both.
  stubBin = await ompRpcStub();
  realAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  realBin = Bun.env.OMPCHAMBER_OMP_BIN;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  Bun.env.OMPCHAMBER_OMP_BIN = stubBin;
  // A sibling test file may have cached the real `omp` path for the process
  // lifetime; without this the stub would be bypassed and a real agent spawned.
  invalidateOmpCliCache();
});

afterAll(() => {
  disposeUtilityRpc();
  if (realAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = realAgentDir;
  if (realBin === undefined) delete Bun.env.OMPCHAMBER_OMP_BIN;
  else Bun.env.OMPCHAMBER_OMP_BIN = realBin;
  invalidateOmpCliCache();
  for (const dir of dirs.splice(0)) removeDir(dir);
});

afterEach(() => {
  disposeUtilityRpc();
  Bun.env.OMPCHAMBER_OMP_BIN = stubBin;
  invalidateOmpCliCache();
  globalThis.__ompChamberDb?.resolved?.raw.close();
  globalThis.__ompChamberDb = undefined;
  delete Bun.env.OMPCHAMBER_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
  delete Bun.env.FAKE_OMP_RESPONSES;
  writeFileSync(join(agentDir, 'models.yml'), 'providers: {}\n');
  rmSync(join(agentDir, 'agent.db'), { force: true });
});

function useTempDb(): void {
  Bun.env.OMPCHAMBER_DB_PATH = join(tempDir(), 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__ompChamberDb = undefined;
}

async function writeOverlayValue(value: string): Promise<void> {
  const db = await getDb();
  await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', ['omp_providers_config', value]);
}

/** The omp registry view: authenticated login providers plus served models. */
function setRegistryView(providers: string[], models: Array<{ id: string; provider: string }>): void {
  Bun.env.FAKE_OMP_RESPONSES = JSON.stringify({
    get_login_providers: { providers: providers.map((id) => ({ id, name: id, authenticated: true })) },
    get_available_models: { models },
  });
}

/** Write the omp agent's own credential stores (models.yml + agent.db). */
function writeOmpStores(options: { yml?: Record<string, string>; agentDb?: Record<string, string> }): void {
  const providers = Object.entries(options.yml ?? {})
    .map(([slug, key]) => `  ${slug}:\n    apiKey: ${key}`)
    .join('\n');
  writeFileSync(join(agentDir, 'models.yml'), `providers:\n${providers}\n`);

  rmSync(join(agentDir, 'agent.db'), { force: true });
  if (!options.agentDb) return;
  const db = new Database(join(agentDir, 'agent.db'), { create: true });
  db.exec('CREATE TABLE auth_credentials (provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT)');
  for (const [slug, key] of Object.entries(options.agentDb)) {
    db.run('INSERT INTO auth_credentials VALUES (?, ?, ?, NULL)', [slug, 'api_key', JSON.stringify({ key })]);
  }
  db.close();
}

describe('loadProviderEntries', () => {
  test('rows are normalized and non-object entries dropped', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([
      { name: 'Kenari', slug: 'kenari', baseUrl: 'https://kenari.id/v1', apiKey: 'k' },
      { slug: 'partial' },
      'not an object',
      null,
    ]));

    expect(await loadProviderEntries()).toEqual([
      { name: 'Kenari', slug: 'kenari', baseUrl: 'https://kenari.id/v1', apiKey: 'k' },
      { name: '', slug: 'partial', baseUrl: '', apiKey: '' },
    ]);
  });

  test('an absent, blank, malformed or non-array overlay reads as no entries', async () => {
    useTempDb();
    expect(await loadProviderEntries()).toEqual([]);
    for (const raw of ['', '{oops', '"a string"']) {
      await writeOverlayValue(raw);
      expect(await loadProviderEntries()).toEqual([]);
    }
  });
});

describe('listCredentialedProviders', () => {
  test('the three stores are merged per slug with every source reported', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([{ name: 'Kenari', slug: 'kenari', baseUrl: '', apiKey: 'app-key' }]));
    writeOmpStores({
      yml: { kenari: 'yml-key', deepseek: 'ds-key' },
      agentDb: { kenari: 'db-key', openrouter: 'or-key' },
    });
    setRegistryView([], []);

    expect(await listCredentialedProviders()).toEqual([
      { slug: 'deepseek', sources: ['models.yml'] },
      { slug: 'kenari', sources: ['models.yml', 'agent.db', 'app DB'] },
      { slug: 'openrouter', sources: ['agent.db'] },
    ]);
  });

  test('a slug omp resolves but no store accounts for is reported as environment', async () => {
    useTempDb();
    writeOmpStores({});
    setRegistryView(['anthropic'], [{ id: 'claude-x', provider: 'google' }]);

    expect(await listCredentialedProviders()).toEqual([
      { slug: 'anthropic', sources: ['environment'] },
      { slug: 'google', sources: ['environment'] },
    ]);
  });

  test('a store slug omp also resolves keeps its store source, not environment', async () => {
    useTempDb();
    writeOmpStores({ yml: { anthropic: 'yml-key' } });
    setRegistryView(['anthropic'], [{ id: 'claude-x', provider: 'anthropic' }]);

    expect(await listCredentialedProviders()).toEqual([{ slug: 'anthropic', sources: ['models.yml'] }]);
  });

  test('a masked placeholder key never counts as a credential', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([
      { name: 'Kenari', slug: 'kenari', baseUrl: '', apiKey: '••••••••' },
      { name: 'DeepSeek', slug: 'deepseek', baseUrl: '', apiKey: 'real-key' },
    ]));
    writeOmpStores({});
    setRegistryView([], []);

    expect(await listCredentialedProviders()).toEqual([{ slug: 'deepseek', sources: ['app DB'] }]);
  });

  test('a slug-less overlay row falls back to its name, lowercased', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([{ name: 'OpenRouter', slug: '', baseUrl: '', apiKey: 'or-key' }]));
    writeOmpStores({});
    setRegistryView([], []);

    expect(await listCredentialedProviders()).toEqual([{ slug: 'openrouter', sources: ['app DB'] }]);
  });

  test('an unreachable omp registry degrades to the store scan', async () => {
    useTempDb();
    Bun.env.OMPCHAMBER_OMP_BIN = join(tempDir(), 'missing-omp');
    invalidateOmpCliCache();
    writeOmpStores({ yml: { deepseek: 'ds-key' } });

    expect(await listCredentialedProviders()).toEqual([{ slug: 'deepseek', sources: ['models.yml'] }]);
  });

  test('the result carries slugs and source names only, never a key', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([{ name: 'Kenari', slug: 'kenari', baseUrl: '', apiKey: 'super-secret' }]));
    writeOmpStores({ yml: { deepseek: 'another-secret' } });
    setRegistryView([], []);

    const serialized = JSON.stringify(await listCredentialedProviders());
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('another-secret');
  });
});

describe('resolveKenariApiKey / resolveDeepSeekApiKey', () => {
  test('the overlay key wins over omp models.yml', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([{ name: 'Kenari', slug: 'kenari', baseUrl: 'https://kenari.id/v1', apiKey: 'app-key' }]));
    writeOmpStores({ yml: { kenari: 'yml-key' } });

    expect(await resolveKenariApiKey('kenari')).toBe('app-key');
  });

  test('a masked overlay key falls through to omp models.yml', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([{ name: 'Kenari', slug: 'kenari', baseUrl: '', apiKey: '••••••' }]));
    writeOmpStores({ yml: { kenari: 'yml-key' } });

    expect(await resolveKenariApiKey('kenari')).toBe('yml-key');
  });

  test('matching is case-insensitive on name, slug and baseUrl', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([{ name: 'DeepSeek Direct', slug: 'ignored', baseUrl: 'https://API.DeepSeek.com/v1', apiKey: 'ds-key' }]));
    writeOmpStores({});

    expect(await resolveDeepSeekApiKey()).toBe('ds-key');
    expect(await resolveKenariApiKey('kenari')).toBeNull();
  });

  test('a provider no store has a key for resolves to null', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([{ name: 'Kenari', slug: 'kenari', baseUrl: '', apiKey: 'app-key' }]));
    writeOmpStores({});

    expect(await resolveDeepSeekApiKey()).toBeNull();
  });

  test('each Kenari account resolves its own key', async () => {
    // Reproduced: the resolver scanned for any entry mentioning kenari and
    // returned the first hit, so `kenari2` could read the first account's quota
    // while its own key was never used.
    useTempDb();
    await writeOverlayValue(JSON.stringify([
      { name: 'Kenari', slug: 'kenari', baseUrl: 'https://kenari.id/v1', apiKey: 'first-key' },
      { name: 'Kenari 2', slug: 'kenari2', baseUrl: 'https://kenari.id/v1', apiKey: 'second-key' },
    ]));
    writeOmpStores({});

    expect(await resolveKenariApiKey('kenari')).toBe('first-key');
    expect(await resolveKenariApiKey('kenari2')).toBe('second-key');
  });

  test("another account's key is never returned for a slug with no entry", async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([
      { name: 'Kenari 2', slug: 'kenari2', baseUrl: 'https://kenari.id/v1', apiKey: 'second-key' },
    ]));
    writeOmpStores({});

    expect(await resolveKenariApiKey('kenari')).toBeNull();
  });

  test('a slug the overlay does not hold falls through to its own models.yml key', async () => {
    useTempDb();
    writeOmpStores({ yml: { kenari2: 'yml-second' } });

    expect(await resolveKenariApiKey('kenari2')).toBe('yml-second');
    expect(await resolveKenariApiKey('kenari')).toBeNull();
  });
});

describe('kenariProviderSlugs', () => {
  test('the slug spelling alone identifies an account', async () => {
    useTempDb();
    writeOmpStores({});
    expect([...(await kenariProviderSlugs(['kenari', 'kenari2', 'deepseek']))].sort()).toEqual(['kenari', 'kenari2']);
  });

  test('an unrelated slug pointed at kenari.id is still Kenari', async () => {
    // The slug is not always a giveaway; the endpoint is what the upstream
    // calls are keyed to, so identity has to consult models.yml too.
    useTempDb();
    writeFileSync(join(agentDir, 'models.yml'), 'providers:\n  kyc-gateway:\n    apiKey: k\n    baseUrl: https://kenari.id/v1\n');
    expect([...(await kenariProviderSlugs(['kyc-gateway', 'openai']))]).toEqual(['kyc-gateway']);
  });

  test('the chamber overlay decides for a slug whose name says kenari', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([{ name: 'Kenari Gateway', slug: 'knri', baseUrl: '', apiKey: 'k' }]));
    writeOmpStores({});
    expect([...(await kenariProviderSlugs(['knri', 'openai']))]).toEqual(['knri']);
  });

  test('a slug nothing accounts for stays out', async () => {
    useTempDb();
    writeOmpStores({ yml: { deepseek: 'ds-key' } });
    expect([...(await kenariProviderSlugs(['deepseek']))]).toEqual([]);
  });
});
