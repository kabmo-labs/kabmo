/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `registry.server.ts` assembles the model list `GET /api/models` serves, and
 * every rule it applies is invisible in the response when it is wrong:
 *
 *  - a provider disabled in omp's config.yml must leave the picker entirely,
 *    while a per-model hide in Kabmo overlay must remove only that model;
 *  - Kabmo's own overlay is also the MOCK path's source of disabled
 *    providers, so a malformed row must degrade to "nothing disabled" rather
 *    than to a crash;
 *  - the model list is cached for 60s and a stale snapshot must be rebuilt —
 *    the invalidation the provider settings rely on after every mutation.
 *
 * A stub binary (KABMO_OMP_BIN) answers the utility RPC with canned
 * frames, so the real agent is never spawned; DB and agent dir are temp files.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { ompRpcStub } from '@/test-support/executable-stub';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb } from '@/server/db.server';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import {
  EMPTY_MODELS,
  invalidateModelsCache,
  loadModelsWithCache,
  readStoredProvidersForModels,
} from '@/server/lib/models/registry.server';
import { disposeUtilityRpc } from '@/server/lib/omp/rpc/utility';
import { removeDir } from '@/test-support/remove-dir';

const dirs: string[] = [];
let agentDir = '';
let realAgentDir: string | undefined;
let realBin: string | undefined;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-test-'));
  dirs.push(dir);
  return dir;
}

beforeAll(async () => {
  agentDir = tempDir();
  // A COMPILED executable, not a `#!/bin/sh` script: `Bun.spawn` on Windows
  // resolves only `.com`/`.exe` through libuv's `search_path`, so a shebang
  // script is unspawnable there however it is chmod-ed.
  const stubPath = await ompRpcStub();
  realAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  realBin = Bun.env.KABMO_OMP_BIN;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  Bun.env.KABMO_OMP_BIN = stubPath;
  // A sibling test file may have cached the real `omp` path for the process
  // lifetime; without this the stub would be bypassed and a real agent spawned.
  invalidateOmpCliCache();
});

afterAll(() => {
  if (realAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = realAgentDir;
  if (realBin === undefined) delete Bun.env.KABMO_OMP_BIN;
  else Bun.env.KABMO_OMP_BIN = realBin;
  invalidateOmpCliCache();
  for (const dir of dirs.splice(0)) removeDir(dir);
});

afterEach(() => {
  disposeUtilityRpc();
  globalThis.__kabmoModelsCache = undefined;
  globalThis.__kabmoLoginProvidersCache = undefined;
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = undefined;
  delete Bun.env.FAKE_OMP_RESPONSES;
  delete Bun.env.KABMO_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
});

/** Point the db singleton at a throwaway file; the real Kabmo db is never opened. */
function useTempDb(): void {
  Bun.env.KABMO_DB_PATH = join(tempDir(), 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__kabmoDb = undefined;
}

async function writeOverlay(value: unknown): Promise<void> {
  const db = await getDb();
  await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
    'omp_providers_config',
    typeof value === 'string' ? value : JSON.stringify(value),
  ]);
}

const SAMPLE_MODELS = [
  { id: 'gpt-5', provider: 'openai', name: 'GPT-5' },
  { id: 'claude-x', provider: 'anthropic', name: 'Claude X', reasoning: true, thinking: { efforts: ['low', 'high'] } },
  { id: 'claude-y', provider: 'anthropic' },
];

describe('readStoredProvidersForModels', () => {
  test('keeps only overlay rows that carry a slug and disabled: true', async () => {
    useTempDb();
    await writeOverlay([
      { slug: 'anthropic', disabled: true },
      { slug: 'openai', disabled: false },
      { name: 'no slug', disabled: true },
      { slug: 42, disabled: true } as unknown as { slug: string; disabled: boolean },
      null as unknown as { slug: string; disabled: boolean },
    ]);
    const stored = await readStoredProvidersForModels();
    expect(stored).toHaveLength(1);
    expect([stored[0]?.slug, stored[0]?.disabled]).toEqual(['anthropic', true]);
  });

  test('an absent settings row reads as no disabled providers', async () => {
    useTempDb();
    expect(await readStoredProvidersForModels()).toEqual([]);
  });

  test('a non-array overlay reads as no disabled providers', async () => {
    useTempDb();
    await writeOverlay({ slug: 'anthropic', disabled: true });
    expect(await readStoredProvidersForModels()).toEqual([]);
  });

  test('malformed JSON reads as no disabled providers instead of throwing', async () => {
    useTempDb();
    await writeOverlay('{not json');
    expect(await readStoredProvidersForModels()).toEqual([]);
  });
});

describe('loadModelsWithCache', () => {
  test('a fresh cached snapshot is returned without rebuilding it', async () => {
    const sentinel = { ...EMPTY_MODELS, models: { 'x:y': 'sentinel' } };
    globalThis.__kabmoModelsCache = { data: sentinel, expiresAt: Date.now() + 60_000 };
    expect(await loadModelsWithCache()).toBe(sentinel);
  });

  test('an expired snapshot is discarded and the registry rebuilt', async () => {
    useTempDb();
    const sentinel = { ...EMPTY_MODELS, models: { 'x:y': 'stale' } };
    globalThis.__kabmoModelsCache = { data: sentinel, expiresAt: Date.now() - 1 };
    Bun.env.FAKE_OMP_RESPONSES = JSON.stringify({ get_available_models: { models: [{ id: 'm1', provider: 'anthropic', name: 'M1' }] } });

    const data = await loadModelsWithCache();
    expect(data).not.toBe(sentinel);
    expect(data.modelList.map((model) => model.id)).toEqual(['m1']);
    expect(globalThis.__kabmoModelsCache?.data).toBe(data);
  });

  test('invalidateModelsCache drops the model and provider caches together', () => {
    globalThis.__kabmoModelsCache = { data: EMPTY_MODELS, expiresAt: Date.now() + 60_000 };
    globalThis.__kabmoLoginProvidersCache = { data: [], expiresAt: Date.now() + 60_000 };
    invalidateModelsCache();
    expect(globalThis.__kabmoModelsCache).toBeUndefined();
    expect(globalThis.__kabmoLoginProvidersCache).toBeUndefined();
  });
});

describe('loadModels', () => {
  test('a provider disabled in config.yml leaves the list; a hidden model is removed alone', async () => {
    useTempDb();
    writeFileSync(join(agentDir, 'config.yml'), 'disabledProviders:\n  - openai\n');
    await writeOverlay([{ slug: 'anthropic', models: [{ id: 'claude-x', isVisible: false }] }]);
    Bun.env.FAKE_OMP_RESPONSES = JSON.stringify({ get_available_models: { models: SAMPLE_MODELS } });

    const data = await loadModelsWithCache();
    expect(data.modelList.map((model) => model.id)).toEqual(['claude-y']);
  });

  test('a blank model name falls back to the id and the list sorts by name', async () => {
    useTempDb();
    Bun.env.FAKE_OMP_RESPONSES = JSON.stringify({
      get_available_models: {
        models: [
          { id: 'zeta', provider: 'anthropic', name: 'Zeta' },
          { id: 'alpha', provider: 'anthropic', name: '   ' },
        ],
      },
    });

    const data = await loadModelsWithCache();
    expect(data.modelList.map((model) => model.name)).toEqual(['alpha', 'Zeta']);
    expect(data.models['anthropic:alpha']).toBe('alpha');
  });

  test('thinking levels and fast-mode support follow the model metadata', async () => {
    useTempDb();
    Bun.env.FAKE_OMP_RESPONSES = JSON.stringify({
      get_available_models: {
        models: [
          { id: 'plain', provider: 'deepseek' },
          { id: 'thinker', provider: 'anthropic', reasoning: true, thinking: { efforts: ['low', 'high'] } },
        ],
      },
    });

    const data = await loadModelsWithCache();
    expect(data.thinkingLevels['deepseek:plain']).toEqual(['off']);
    expect(data.thinkingLevels['anthropic:thinker']).toEqual(['off', 'low', 'high']);
    expect(data.modelList.find((model) => model.id === 'thinker')?.supportsFastMode).toBe(true);
    expect(data.modelList.find((model) => model.id === 'plain')?.supportsFastMode).toBe(false);
  });

  test('connectedProviders carries authenticated providers and the default model', async () => {
    useTempDb();
    Bun.env.FAKE_OMP_RESPONSES = JSON.stringify({
      get_available_models: { models: SAMPLE_MODELS },
      get_login_providers: {
        providers: [
          { id: 'anthropic', name: 'Anthropic', authenticated: true },
          { id: 'openai', name: 'OpenAI', authenticated: false },
        ],
      },
      get_state: { model: { provider: 'anthropic', id: 'claude-x' } },
    });

    const data = await loadModelsWithCache();
    expect(data.connectedProviders).toEqual([{ id: 'anthropic', name: 'Anthropic', disabled: false }]);
    expect(data.defaultModel).toEqual({ provider: 'anthropic', modelId: 'claude-x' });
  });

  test('a default model that is not in the available list is dropped', async () => {
    useTempDb();
    Bun.env.FAKE_OMP_RESPONSES = JSON.stringify({
      get_available_models: { models: SAMPLE_MODELS },
      get_state: { model: { provider: 'anthropic', id: 'missing' } },
    });

    const data = await loadModelsWithCache();
    expect(data.defaultModel).toBeNull();
  });

  test('model and login-provider entries missing their required fields are dropped', async () => {
    useTempDb();
    Bun.env.FAKE_OMP_RESPONSES = JSON.stringify({
      get_available_models: { models: [{ id: 'ok', provider: 'p' }, { id: 7, provider: 'p' }, { provider: 'p' }, null, 'x'] },
      get_login_providers: { providers: [{ id: 'a', name: 'A', authenticated: true }, { id: 'b', authenticated: true }, null] },
    });

    const data = await loadModelsWithCache();
    expect(data.modelList.map((model) => model.id)).toEqual(['ok']);
    expect(data.connectedProviders).toEqual([{ id: 'a', name: 'A', disabled: false }]);
  });

  test('a registry response that is not an array yields an empty list', async () => {
    useTempDb();
    Bun.env.FAKE_OMP_RESPONSES = JSON.stringify({ get_available_models: { models: 'nope' }, get_login_providers: {} });

    const data = await loadModelsWithCache();
    expect(data.modelList).toEqual([]);
    expect(data.models).toEqual({});
    expect(data.connectedProviders).toEqual([]);
  });
});
