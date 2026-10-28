/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The window a session with no turn yet should be measured against.
 *
 * `resolveSelectedModelContextLimit` reads the composer's persisted pick
 * (`omp_selected_model`) and resolves it against the live registry. It is the
 * fallback path only: a session whose transcript names a model keeps that
 * model's window, and this one covers the window BEFORE the first turn exists.
 *
 * Pinned here: a stored pick resolves to its model's window; a pick that no
 * longer exists in the registry resolves to null (the caller keeps the
 * historical constant rather than inventing one); and a missing or malformed
 * row resolves to null instead of throwing.
 *
 * The registry is served by a STUB binary (`KABMO_OMP_BIN`), so the real
 * agent is never spawned — a real one does not exist on a CI runner, and a test
 * that reaches for it fails there while passing on a developer machine. Same
 * harness as `registry.server.test.ts`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ompRpcStub } from '@/test-support/executable-stub';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb } from '@/server/db.server';
import { writeSettingsJson } from '@/server/lib/db/settings-store';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { disposeUtilityRpc } from '@/server/lib/omp/rpc/utility';
import { loadModelsWithCache } from '@/server/lib/models/registry.server';
import { resolveSelectedModelContextLimit } from '@/server/lib/models/selected-context-limit.server';
import { removeDir } from '@/test-support/remove-dir';

const SELECTED_MODEL_KEY = 'omp_selected_model';

/** Two models with distinct windows, so a wrong pick cannot pass by accident. */
const REGISTRY_MODELS = {
  get_available_models: {
    models: [
      { id: 'small-model', provider: 'alpha', name: 'Small', contextWindow: 128_000 },
      { id: 'big-model', provider: 'beta', name: 'Big', contextWindow: 1_000_000 },
    ],
  },
  get_login_providers: { providers: [] },
  get_state: { model: { provider: 'alpha', id: 'small-model' } },
};

const dirs: string[] = [];
let realAgentDir: string | undefined;
let realBin: string | undefined;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-ctx-limit-'));
  dirs.push(dir);
  return dir;
}

beforeAll(async () => {
  const stubPath = await ompRpcStub();
  realAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  realBin = Bun.env.KABMO_OMP_BIN;
  Bun.env.PI_CODING_AGENT_DIR = tempDir();
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

beforeEach(() => {
  // A throwaway database per test: the real Kabmo db is never opened, and the
  // pick under test is written where the resolver reads it.
  Bun.env.KABMO_DB_PATH = join(tempDir(), 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  Bun.env.FAKE_OMP_RESPONSES = JSON.stringify(REGISTRY_MODELS);
  delete Bun.env.MOCK;
  globalThis.__kabmoDb = undefined;
  globalThis.__kabmoModelsCache = undefined;
});

afterEach(() => {
  disposeUtilityRpc();
  globalThis.__kabmoModelsCache = undefined;
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = undefined;
  delete Bun.env.FAKE_OMP_RESPONSES;
  delete Bun.env.KABMO_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
});

/** The stub's `small-model` entry, as the registry reports it. */
async function registryModel(): Promise<{ provider: string; id: string; contextWindow: number }> {
  const models = await loadModelsWithCache();
  const hit = models.modelList.find((model) => model.id === 'small-model');
  if (!hit?.contextWindow) throw new Error('stub registry served no small-model context window');
  return { provider: hit.provider, id: hit.id, contextWindow: hit.contextWindow };
}

describe('resolveSelectedModelContextLimit', () => {
  test("resolves the persisted pick to that model's window", async () => {
    const model = await registryModel();
    const db = await getDb();
    await writeSettingsJson(db, SELECTED_MODEL_KEY, {
      id: model.id,
      provider: model.provider,
      name: model.id,
    });

    expect(await resolveSelectedModelContextLimit()).toBe(model.contextWindow);
  });

  test('reads the `modelId` spelling as well as `id`', async () => {
    const model = await registryModel();
    const db = await getDb();
    await writeSettingsJson(db, SELECTED_MODEL_KEY, {
      modelId: model.id,
      provider: model.provider,
    });

    expect(await resolveSelectedModelContextLimit()).toBe(model.contextWindow);
  });

  test('returns the window of the model that was picked, not another provider\'s', async () => {
    const db = await getDb();
    await writeSettingsJson(db, SELECTED_MODEL_KEY, {
      id: 'big-model',
      provider: 'beta',
    });

    expect(await resolveSelectedModelContextLimit()).toBe(1_000_000);
  });

  test('returns null for a pick the registry no longer serves', async () => {
    const db = await getDb();
    await writeSettingsJson(db, SELECTED_MODEL_KEY, {
      id: 'model-that-does-not-exist',
      provider: 'provider-that-does-not-exist',
    });

    expect(await resolveSelectedModelContextLimit()).toBeNull();
  });

  test('returns null for a malformed row rather than throwing', async () => {
    const db = await getDb();
    await writeSettingsJson(db, SELECTED_MODEL_KEY, { provider: 'only-a-provider' });

    expect(await resolveSelectedModelContextLimit()).toBeNull();
  });
});
