/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The settings routes that write omp's OWN config files: `omp-config`,
 * `model-override` and `provider-model`.
 *
 * These three are the only settings routes whose mistakes reach the agent
 * itself, so the cases here pin the refusals that keep a bad request from
 * corrupting a file omp then refuses to load:
 *
 * - `omp-config` requires a non-blank `key`, refuses `value: null`/`undefined`
 *   with the accepted-type message, and surfaces the CLI's own refusal
 *   (`config writes are unavailable in mock mode`) instead of pretending a
 *   write happened.
 * - `model-override` accepts only PUT/POST, only a positive finite
 *   `maxTokens`, only an effort in omp's vocabulary, and refuses an empty
 *   patch with `nothing to write` rather than rewriting the file unchanged.
 * - `provider-model` requires `provider` and `id`, and reports the writer's
 *   refusal as a 400 with its reason — registering a model under a provider
 *   that has no models.yml entry and no api key must not write half an entry.
 *
 * Everything runs offline against a temp agent dir: no case may spawn `omp` or
 * touch the developer's `~/.omp`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { action as modelOverrideAction } from '@/server/routes/settings/model-override';
import { action as ompConfigAction, loader as ompConfigLoader } from '@/server/routes/settings/omp-config';
import { action as providerModelAction } from '@/server/routes/settings/provider-model';

// `tmpdir()` rather than a literal `/tmp`: on Windows there is no `/tmp`, so a
// POSIX-literal root makes every write land at a path the OS resolves against
// the current drive — the fixture directories never exist where the route looks
// for them, and the request fails for a reason unrelated to what is under test.
const ROOT = path.join(os.tmpdir(), 'omc-settings-config-routes-test');
const AGENT_DIR = path.join(ROOT, 'agent');
const MODELS_YML = path.join(AGENT_DIR, 'models.yml');
const API = 'http://localhost/api/settings';

beforeAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = AGENT_DIR;
  Bun.env.KABMO_DB_PATH = path.join(ROOT, 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
});

afterEach(() => {
  delete Bun.env.MOCK;
  fs.rmSync(MODELS_YML, { force: true });
});

afterAll(() => {
  delete Bun.env.PI_CODING_AGENT_DIR;
  delete Bun.env.KABMO_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
  delete Bun.env.MOCK;
  fs.rmSync(ROOT, { recursive: true, force: true });
});

type Handler = (args: never) => unknown;

function call(handler: Handler, request: Request): Promise<Response> {
  return handler({ request, params: {} } as never) as Promise<Response>;
}

function send(url: string, verb: string, body?: unknown): Request {
  return new Request(url, {
    method: verb,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}

function readModelsYml(): Record<string, any> {
  return parseYaml(fs.readFileSync(MODELS_YML, 'utf8')) as Record<string, any>;
}

describe('settings omp-config', () => {
  test('the loader answers one key and the whole list under MOCK', async () => {
    Bun.env.MOCK = 'true';
    const one = await (await call(ompConfigLoader, new Request(`${API}/omp-config?key=theme`))).json();
    expect(one).toEqual({ key: 'theme', value: null, isMock: true });

    const all = await (await call(ompConfigLoader, new Request(`${API}/omp-config`))).json();
    expect(all).toEqual({ entries: {}, isMock: true });
  });

  test('a missing or blank key is refused with its own message', async () => {
    for (const body of [{}, { key: '' }, { key: '   ' }, { key: 42 }, { key: 'x', value: 'v' }]) {
      const res = await call(ompConfigAction, send(`${API}/omp-config`, 'POST', body));
      if (body.key === 'x') continue;
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'key is required' });
    }
  });

  test('a null or undefined value is refused with the accepted-type message', async () => {
    for (const body of [{ key: 'theme', value: null }, { key: 'theme' }]) {
      const res = await call(ompConfigAction, send(`${API}/omp-config`, 'POST', body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'value must be a string, number, boolean, array, or record' });
    }
  });

  test('the CLI refusal reaches the client instead of a fake success', async () => {
    Bun.env.MOCK = 'true';
    const write = await call(ompConfigAction, send(`${API}/omp-config`, 'POST', { key: 'theme', value: 'dark' }));
    expect(write.status).toBe(500);
    expect(await write.json()).toEqual({ error: 'config writes are unavailable in mock mode' });

    const reset = await call(ompConfigAction, send(`${API}/omp-config`, 'POST', { key: 'theme', action: 'reset' }));
    expect(reset.status).toBe(500);
    expect(await reset.json()).toEqual({ error: 'config writes are unavailable in mock mode' });
  });

  test('a wrong verb is the route-owned 405', async () => {
    const res = await call(ompConfigAction, send(`${API}/omp-config`, 'DELETE'));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'Method not allowed' });
  });
});

describe('settings model-override', () => {
  test('provider and modelId are required after trimming', async () => {
    for (const body of [{}, { provider: 'acme' }, { modelId: 'm1' }, { provider: '  ', modelId: 'm1' }, { provider: 'acme', modelId: 7 }]) {
      const res = await call(modelOverrideAction, send(`${API}/model-override`, 'PUT', body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'provider and modelId are required' });
    }
  });

  test('maxTokens must be positive or null', async () => {
    for (const maxTokens of ['100', 0, -5, true]) {
      const res = await call(modelOverrideAction, send(`${API}/model-override`, 'PUT', { provider: 'acme', modelId: 'm1', maxTokens }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'maxTokens must be a positive number or null' });
    }
  });

  test('reasoningEffort must be one of omp’s levels or null', async () => {
    const res = await call(modelOverrideAction, send(`${API}/model-override`, 'PUT', { provider: 'acme', modelId: 'm1', reasoningEffort: 'ultra' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'reasoningEffort must be one of minimal, low, medium, high, xhigh, max or null' });
  });

  test('an empty patch is refused rather than rewriting the file unchanged', async () => {
    const res = await call(modelOverrideAction, send(`${API}/model-override`, 'PUT', { provider: 'acme', modelId: 'm1' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'nothing to write' });
  });

  test('MOCK accepts a valid patch without touching models.yml', async () => {
    Bun.env.MOCK = 'true';
    const res = await call(modelOverrideAction, send(`${API}/model-override`, 'POST', { provider: 'acme', modelId: 'm1', maxTokens: 2048, reasoningEffort: 'high' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, written: false, isMock: true });
    expect(fs.existsSync(MODELS_YML)).toBe(false);
  });

  test('a model omp does not know is reported, not written', async () => {
    const res = await call(modelOverrideAction, send(`${API}/model-override`, 'PUT', { provider: 'ghost', modelId: 'nope', maxTokens: 100 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: false,
      written: false,
      unknownTarget: true,
      reason: 'nope is not registered under provider "ghost" in models.yml',
    });
    expect(fs.existsSync(MODELS_YML)).toBe(false);
  });

  test('a registered model gets its override written into models.yml', async () => {
    fs.writeFileSync(MODELS_YML, 'providers:\n  acme:\n    apiKey: sk-test\n    models:\n      - id: m1\n');
    const res = await call(modelOverrideAction, send(`${API}/model-override`, 'PUT', { provider: 'acme', modelId: 'm1', maxTokens: 1234.6, reasoningEffort: 'low' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, written: true });

    const override = readModelsYml().providers.acme.modelOverrides.m1;
    expect(override.maxTokens).toBe(1235);
    expect(override.thinking).toMatchObject({ mode: 'effort', defaultLevel: 'low' });
    expect(override.thinking.efforts).toContain('low');
  });

  test('a wrong verb is the route-owned 405', async () => {
    const res = await call(modelOverrideAction, send(`${API}/model-override`, 'DELETE'));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'Method not allowed' });
  });
});

describe('settings provider-model', () => {
  test('provider and model id are required', async () => {
    for (const body of [{}, { provider: 'acme' }, { id: 'm1' }, { provider: ' ', id: ' ' }]) {
      const res = await call(providerModelAction, send(`${API}/provider-model`, 'POST', body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'provider and model id are required' });
    }
  });

  test('MOCK echoes the added id without writing models.yml', async () => {
    Bun.env.MOCK = 'true';
    const res = await call(providerModelAction, send(`${API}/provider-model`, 'POST', { provider: 'acme', id: ' m1 ' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, written: false, isMock: true, addedModels: ['m1'] });
    expect(fs.existsSync(MODELS_YML)).toBe(false);
  });

  test('a provider with no models.yml entry and no api key is refused', async () => {
    const res = await call(providerModelAction, send(`${API}/provider-model`, 'POST', { provider: 'unknown-gw', id: 'm1' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.written).toBe(false);
    expect(body.alreadyKnown).toBe(false);
    expect(body.reason).toBe('provider not yet in models.yml and no api key available to register it');
  });

  test('a model already in models.yml is reported as known, not re-added', async () => {
    fs.writeFileSync(MODELS_YML, 'providers:\n  acme:\n    apiKey: sk-test\n    models:\n      - id: m1\n');
    const res = await call(providerModelAction, send(`${API}/provider-model`, 'POST', { provider: 'acme', id: 'm1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyKnown).toBe(true);
    expect(body.success).toBe(true);
    expect(body.reason).toBe('m1 is already registered under "acme" in models.yml');
  });

  test('a new model is written with rounded limits and only known efforts', async () => {
    fs.writeFileSync(MODELS_YML, 'providers:\n  acme:\n    apiKey: sk-test\n    models:\n      - id: m1\n');
    const res = await call(providerModelAction, send(`${API}/provider-model`, 'POST', {
      provider: 'acme',
      id: 'm2',
      name: 'Second',
      contextWindow: 128000.4,
      maxTokens: 4096.6,
      reasoning: true,
      imageInput: true,
      efforts: ['low', 'ultra', 'high'],
      costInput: 1,
      costOutput: 2,
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, written: true, addedModels: ['m2'] });

    const model = readModelsYml().providers.acme.models.find((entry: { id: string }) => entry.id === 'm2');
    expect(model.contextWindow).toBe(128000);
    expect(model.maxTokens).toBe(4097);
    // The ladder is written as the model's `thinking` block (`mode` plus the
    // efforts), and `ultra` never reaches the file — omp would reject it and
    // one unknown value disables every custom provider.
    expect(model.thinking).toEqual({ mode: 'effort', efforts: ['low', 'high'] });
    expect(model.reasoning).toBe(true);
    // Image input is a modality list, not a boolean flag: omp reads
    // `input: ['text', 'image']`.
    expect(model.input).toEqual(['text', 'image']);
    expect(model.cost).toEqual({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
  });

  test('a wrong verb is the route-owned 405', async () => {
    const res = await call(providerModelAction, send(`${API}/provider-model`, 'GET'));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'Method not allowed' });
  });
});
