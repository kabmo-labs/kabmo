/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model-role presets, end to end over the real route and a temp database.
 *
 * The properties pinned here are the ones a preset picker depends on:
 *
 *   - A preset is stored in Kabmo's OWN table (`model_role_presets`), so it
 *     survives a restart and does not depend on omp's config.yml.
 *   - A name is unique case-insensitively — saving "Cheap" twice is one preset,
 *     and the second answer names the collision instead of the SQLite sentence.
 *   - `PUT` writes the WHOLE map, which is what applying a preset is; an empty
 *     selector removes a role rather than storing `''`.
 *   - A custom role id survives, because `modelRoles` accepts them and the map
 *     is written back whole — filtering would silently delete one.
 *
 * `omp` is never spawned: the loader's catalog read is pointed at MOCK mode by
 * the candidate test's own fixture (see `mock.server.ts`), and the rest of the
 * route does not touch it.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import { getDb } from '@/server/db.server';
import { initSchema } from '@/server/lib/db/schema';
import { action, loader } from '@/server/routes/models/roles';
import {
  SEEDED_PRESET_NAME,
  deleteModelRolePreset,
  listModelRolePresets,
  saveModelRolePreset,
  seedPresetFromCurrentRoles,
} from '@/server/lib/model-roles/store.server';

type Handler = (args: never) => unknown;

const originalAgentDir = Bun.env.PI_CODING_AGENT_DIR;
const originalMock = Bun.env.MOCK;
let agentDir = '';

beforeEach(async () => {
  // A temp agent dir, not the developer's: `PUT` writes `config.yml`, and a
  // suite that pointed at `~/.omp/agent` would rewrite a live install's roles.
  agentDir = mkdtempSync(join(tmpdir(), 'omc-role-presets-'));
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  await isolateDb();
  await initSchema(await getDb());
  Bun.env.MOCK = 'true';
});

afterEach(async () => {
  await releaseDb();
  removeDir(agentDir);
  if (originalAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
});

function call(handler: Handler, request: Request): Promise<Response> {
  return handler({ request, params: {} } as never) as Promise<Response>;
}

function send(verb: string, body?: unknown, query = ''): Request {
  return new Request(`http://localhost/api/model-roles${query}`, {
    method: verb,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}

describe('preset store', () => {
  test('a preset round-trips its whole role map', async () => {
    const saved = await saveModelRolePreset({
      id: null,
      name: 'cheap',
      roles: { default: 'kenari/deepseek-v4-flash', tiny: 'local/gemma-3-1b' },
    });
    expect(saved.name).toBe('cheap');
    expect(saved.roles).toEqual({ default: 'kenari/deepseek-v4-flash', tiny: 'local/gemma-3-1b' });
    expect(await listModelRolePresets()).toEqual([saved]);
  });

  test('a duplicate name is refused with a sentence, case-insensitively', async () => {
    await saveModelRolePreset({ id: null, name: 'Cheap', roles: { default: 'a/b' } });
    await expect(saveModelRolePreset({ id: null, name: 'cheap', roles: { default: 'c/d' } }))
      .rejects.toThrow('A preset named “cheap” already exists');
  });

  test('an update keeps created_at and moves updated_at', async () => {
    const first = await saveModelRolePreset({ id: null, name: 'p', roles: { default: 'a/b' } });
    const second = await saveModelRolePreset({ id: first.id, name: 'p2', roles: { default: 'c/d' } });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('p2');
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  test('an empty selector is dropped and a custom role id survives', async () => {
    const saved = await saveModelRolePreset({
      id: null,
      name: 'mixed',
      roles: { default: 'a/b', tiny: '   ', 'my-role': 'x/y', 'bad role': 'z/z' },
    });
    expect(saved.roles).toEqual({ default: 'a/b', 'my-role': 'x/y' });
  });

  test('a preset with no usable role is refused', async () => {
    await expect(saveModelRolePreset({ id: null, name: 'empty', roles: { default: '' } }))
      .rejects.toThrow('A preset needs at least one role assigned');
  });

  test('a blank name is refused', async () => {
    await expect(saveModelRolePreset({ id: null, name: '   ', roles: { default: 'a/b' } }))
      .rejects.toThrow('Preset name is required');
  });
});

describe('one-shot seed from the install’s current roles', () => {
  test('an install with roles and no presets gets one preset named Default', async () => {
    Bun.env.MOCK = 'false';
    await seedPresetFromCurrentRoles({ default: 'kenari/deepseek-v4-flash', plan: 'kenari/deepseek-v4-pro' });
    const presets = await listModelRolePresets();
    expect(presets.length).toBe(1);
    expect(presets[0].name).toBe(SEEDED_PRESET_NAME);
    expect(presets[0].roles).toEqual({ default: 'kenari/deepseek-v4-flash', plan: 'kenari/deepseek-v4-pro' });
  });

  test('a deleted seed is NOT resurrected on the next read', async () => {
    Bun.env.MOCK = 'false';
    await seedPresetFromCurrentRoles({ default: 'a/b' });
    const [seeded] = await listModelRolePresets();
    await deleteModelRolePreset(seeded.id);

    await seedPresetFromCurrentRoles({ default: 'a/b' });
    expect(await listModelRolePresets()).toEqual([]);
  });

  test('a table that already holds a preset is left alone', async () => {
    Bun.env.MOCK = 'false';
    await saveModelRolePreset({ id: null, name: 'mine', roles: { default: 'x/y' } });
    await seedPresetFromCurrentRoles({ default: 'a/b' });
    expect((await listModelRolePresets()).map((preset) => preset.name)).toEqual(['mine']);
  });

  test('a map with no roles seeds nothing but still spends the run', async () => {
    Bun.env.MOCK = 'false';
    await seedPresetFromCurrentRoles({});
    expect(await listModelRolePresets()).toEqual([]);
    // The run is spent: a later non-empty map does not seed retroactively.
    await seedPresetFromCurrentRoles({ default: 'a/b' });
    expect(await listModelRolePresets()).toEqual([]);
  });

  test('mock mode writes no demo preset into the database', async () => {
    Bun.env.MOCK = 'true';
    await seedPresetFromCurrentRoles({ default: 'a/b' });
    expect(await listModelRolePresets()).toEqual([]);
  });
});

describe('model-roles route', () => {
  test('GET answers roles, presets and candidates together', async () => {
    const res = await call(loader, send('GET'));
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.roles).toEqual({});
    expect(body.presets).toEqual([]);
    // Mock mode answers the demo catalog — never a spawn, never a network read.
    expect(Array.isArray(body.candidates)).toBe(true);
    expect((body.candidates as unknown[]).length).toBeGreaterThan(0);
  });

  test('POST saves a preset and answers the whole list', async () => {
    const res = await call(action, send('POST', { preset: { name: 'fast', roles: { default: 'a/b' } } }));
    const body = await res.json() as { success: boolean; preset: { id: string }; presets: unknown[] };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.presets.length).toBe(1);
  });

  test('a duplicate name answers 400 with the refusal sentence', async () => {
    await call(action, send('POST', { preset: { name: 'dup', roles: { default: 'a/b' } } }));
    const res = await call(action, send('POST', { preset: { name: 'dup', roles: { default: 'c/d' } } }));
    const body = await res.json() as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toContain('already exists');
  });

  test('DELETE removes by id and 404s an unknown one', async () => {
    const created = await call(action, send('POST', { preset: { name: 'gone', roles: { default: 'a/b' } } }));
    const { preset } = await created.json() as { preset: { id: string } };
    const removed = await call(action, send('DELETE', undefined, `?id=${preset.id}`));
    expect(removed.status).toBe(200);
    expect(await listModelRolePresets()).toEqual([]);

    const missing = await call(action, send('DELETE', undefined, '?id=nope'));
    expect(missing.status).toBe(404);
  });

  test('PUT writes the whole map through config.yml, dropping blank selectors', async () => {
    const res = await call(action, send('PUT', { roles: { default: 'kenari/deepseek-v4-flash', tiny: '' } }));
    const body = await res.json() as { success: boolean; roles: Record<string, string> };
    expect(res.status).toBe(200);
    expect(body.roles).toEqual({ default: 'kenari/deepseek-v4-flash' });

    // Read back through the loader: the map really landed in the file.
    const reloaded = await call(loader, send('GET'));
    expect((await reloaded.json() as { roles: Record<string, string> }).roles)
      .toEqual({ default: 'kenari/deepseek-v4-flash' });
  });
});
