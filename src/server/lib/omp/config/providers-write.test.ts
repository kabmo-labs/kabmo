/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `models.yml` provider upsert, driven through a temp agent dir so the real
 * registry is never touched. Two modes: add-only (register a provider, add one
 * model by hand) and `replaceModels` (a fetch, where the listing IS the list).
 *
 * The rules worth pinning are the ones that protect a hand-authored file:
 * - an EXISTING provider keeps its `baseUrl`/`apiKey`/`api` — a re-save must
 *   never overwrite a credential the user pinned;
 * - a provider that does not exist yet is ALWAYS a change, which is what makes
 *   a discovery/override registration with no model ids land at all;
 * - a new models-carrying provider without a usable key is refused (never
 *   written half-configured), and a masked placeholder is refused outright;
 * - a map-form `models` entry aborts the write instead of being flattened;
 * - a discovery provider keeps an empty model list (omp owns those models);
 * - `replaceModels` prunes the ids the listing dropped, while the add-only path
 *   keeps an id the listing omits — a hand-added model is the user's.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { upsertOmpProviderModels, removeOmpProvider } from '@/server/lib/omp/config/providers';
import { OmpConfigError } from '@/server/lib/omp/config/document';

const originalAgentDir = Bun.env.PI_CODING_AGENT_DIR;
const roots: string[] = [];
let agentDir = '';

beforeEach(async () => {
  const root = await fs.promises.mkdtemp(join(tmpdir(), 'omp-providers-'));
  roots.push(root);
  agentDir = join(root, 'agent');
  await fs.promises.mkdir(agentDir, { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
});

afterAll(async () => {
  if (originalAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = originalAgentDir;
  for (const root of roots) await fs.promises.rm(root, { recursive: true, force: true });
});

const modelsPath = () => join(agentDir, 'models.yml');

interface ProviderEntry {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  auth?: string;
  discovery?: { type?: string };
  models?: Array<Record<string, unknown>>;
}
interface ModelsDoc { providers?: Record<string, ProviderEntry> }

/** Read back through fs: Bun.file memoizes across the atomic rename. */
async function readModels(): Promise<ModelsDoc> {
  return Bun.YAML.parse(await fs.promises.readFile(modelsPath(), 'utf8')) as ModelsDoc;
}

/** The providers map of a document just written: nothing to merge, nothing optional. */
function providersOf(doc: ModelsDoc): Record<string, ProviderEntry> {
  if (!doc.providers) throw new Error('models.yml has no providers map');
  return doc.providers;
}

describe('upsertOmpProviderModels — new providers', () => {
  test('a full provider writes baseUrl, apiKey, api and its models', async () => {
    const result = await upsertOmpProviderModels('custom/gateway', {
      baseUrl: 'https://gw.example/v1',
      apiKey: 'sk-live',
      models: [{ id: 'gpt-x', name: 'GPT X', contextWindow: 128000 }],
    });

    expect(result).toEqual({
      written: true,
      addedModels: ['gpt-x'],
      backfilledModels: [],
      removedModels: [],
      skippedModels: [],
    });
    const providers = providersOf(await readModels());
    expect(providers['custom/gateway']).toEqual({
      baseUrl: 'https://gw.example/v1',
      apiKey: 'sk-live',
      api: 'openai-completions',
      models: [{ id: 'gpt-x', name: 'GPT X', input: ['text'], contextWindow: 128000 }],
    });
  });

  test('auth: none registers a keyless provider without an apiKey field', async () => {
    await upsertOmpProviderModels('local', {
      baseUrl: 'http://localhost:11434/v1',
      auth: 'none',
      models: [{ id: 'llama' }],
    });
    const entry = providersOf(await readModels()).local ?? {} as unknown as unknown as ProviderEntry;
    expect(entry.apiKey).toBeUndefined();
    expect(entry.auth).toBe('none');
  });

  test('a discovery provider keeps an EMPTY model list and records its type', async () => {
    const result = await upsertOmpProviderModels('ollama', {
      baseUrl: 'http://localhost:11434',
      apiKey: 'unused',
      discovery: 'ollama',
      models: [],
    });
    expect(result.written).toBe(true);
    expect(result.addedModels).toEqual([]);
    const entry = providersOf(await readModels()).ollama ?? {} as unknown as unknown as ProviderEntry;
    expect(entry.discovery).toEqual({ type: 'ollama' });
    expect(entry.models).toEqual([]);
  });

  test('an override-only provider is a change even with no models and no key', async () => {
    // omp already bundles this provider's catalog; Kabmo only moves the
    // endpoint. Without `!existing` in `providerChanged` nothing would be
    // written and the override would silently vanish.
    const result = await upsertOmpProviderModels('openai', {
      baseUrl: 'https://proxy.internal/v1',
      overrideOnly: true,
      models: [],
    });
    expect(result.written).toBe(true);
    const entry = providersOf(await readModels()).openai ?? {} as unknown as unknown as ProviderEntry;
    expect(entry.baseUrl).toBe('https://proxy.internal/v1');
    expect(entry.models).toEqual([]);
    expect(entry.apiKey).toBeUndefined();
  });

  test('refuses a models-carrying provider with no api key', async () => {
    const result = await upsertOmpProviderModels('nokey', {
      baseUrl: 'https://x.example',
      models: [{ id: 'm1' }],
    });
    expect(result.written).toBe(false);
    expect(result.skippedModels).toEqual(['m1']);
    expect(result.reason).toBe('provider not yet in models.yml and no api key available to register it');
    expect(await Bun.file(modelsPath()).exists()).toBe(false);
  });

  test('refuses a masked API key placeholder', async () => {
    const result = await upsertOmpProviderModels('masked', {
      baseUrl: 'https://x.example',
      apiKey: 'sk-••••••••',
      models: [{ id: 'm1' }],
    });
    expect(result.written).toBe(false);
    expect(result.reason).toBe('the supplied API key is a masked placeholder, not a credential');
    expect(await Bun.file(modelsPath()).exists()).toBe(false);
  });
});

describe('upsertOmpProviderModels — add-only against an existing provider', () => {
  const seed = [
    'providers:',
    '  pinned:',
    '    baseUrl: https://old.example',
    '    apiKey: sk-old',
    '    models:',
    '      - id: m1',
    '',
  ].join('\n');

  test('a re-save keeps baseUrl/apiKey and only fills a missing api', async () => {
    await Bun.write(modelsPath(), seed);
    const result = await upsertOmpProviderModels('pinned', {
      baseUrl: 'https://new.example',
      apiKey: 'sk-new',
      api: 'anthropic-messages',
      models: [{ id: 'm1' }, { id: 'm2' }],
    });

    expect(result.written).toBe(true);
    expect(result.addedModels).toEqual(['m2']);
    expect(result.skippedModels).toEqual(['m1']);
    const entry = providersOf(await readModels()).pinned ?? {} as unknown as unknown as ProviderEntry;
    expect(entry.baseUrl).toBe('https://old.example');
    expect(entry.apiKey).toBe('sk-old');
    expect(entry.api).toBe('anthropic-messages');
    expect(entry.models?.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  test('nothing new and no dialect change reports written: false', async () => {
    await Bun.write(modelsPath(), seed);
    const result = await upsertOmpProviderModels('pinned', {
      baseUrl: 'https://new.example',
      apiKey: 'sk-new',
      models: [{ id: 'm1' }],
    });
    expect(result).toEqual({
      written: false,
      addedModels: [],
      backfilledModels: [],
      removedModels: [],
      skippedModels: ['m1'],
      reason: 'all models already registered',
    });
  });

  test('backfills a bare existing model from the fetched metadata', async () => {
    await Bun.write(modelsPath(), seed);
    const result = (await upsertOmpProviderModels('pinned', {
      baseUrl: 'https://old.example',
      apiKey: 'sk-old',
      models: [{ id: 'm1', name: 'M One', contextWindow: 64000 }],
    })) as { backfilledModels: unknown; addedModels: unknown };
    expect(result.backfilledModels).toEqual(['m1']);
    expect(result.addedModels).toEqual([]);
  });

  test('an existing map-form models entry aborts instead of being flattened', async () => {
    await Bun.write(modelsPath(), 'providers:\n  broken:\n    baseUrl: https://x\n    models:\n      a:\n        name: A\n');
    await expect(upsertOmpProviderModels('broken', {
      baseUrl: 'https://x',
      apiKey: 'sk-k',
      models: [{ id: 'new' }],
    })).rejects.toThrow(OmpConfigError);
    // The user's file is untouched.
    expect(await fs.promises.readFile(modelsPath(), 'utf8')).toContain('a:\n        name: A');
  });
});

describe('upsertOmpProviderModels — replaceModels against an existing provider', () => {
  const seed = [
    'providers:',
    '  gw:',
    '    baseUrl: https://gw.example/v1',
    '    apiKey: sk-live',
    '    api: openai-completions',
    '    models:',
    '      - id: withdrawn',
    '      - id: kept',
    '        name: Old Name',
    '',
  ].join('\n');

  test('prunes the ids the listing no longer carries and refreshes the rest', async () => {
    await Bun.write(modelsPath(), seed);
    const result = await upsertOmpProviderModels('gw', {
      baseUrl: 'https://gw.example/v1',
      apiKey: 'sk-live',
      replaceModels: true,
      models: [
        { id: 'kept', name: 'New Name', contextWindow: 64000 },
        { id: 'brand-new' },
      ],
    });

    expect(result.written).toBe(true);
    expect(result.addedModels).toEqual(['brand-new']);
    expect(result.backfilledModels).toEqual(['kept']);
    expect(result.removedModels).toEqual(['withdrawn']);
    const entry = providersOf(await readModels()).gw ?? {} as unknown as unknown as ProviderEntry;
    expect(entry.models?.map((m) => m.id)).toEqual(['kept', 'brand-new']);
    expect(entry.models?.[0].name).toBe('New Name');
  });

  test('the add-only path still keeps an id the listing omits', async () => {
    // Registering a provider (or adding one model by hand) must never prune:
    // the existing entry belongs to the user.
    await Bun.write(modelsPath(), seed);
    const result = await upsertOmpProviderModels('gw', {
      baseUrl: 'https://gw.example/v1',
      apiKey: 'sk-live',
      models: [{ id: 'brand-new' }],
    });

    expect(result.removedModels).toEqual([]);
    const entry = providersOf(await readModels()).gw ?? {} as unknown as unknown as ProviderEntry;
    expect(entry.models?.map((m) => m.id)).toEqual(['withdrawn', 'kept', 'brand-new']);
  });

  test('an override-only entry never prunes omp\'s own catalog list', async () => {
    await Bun.write(modelsPath(), seed);
    const result = await upsertOmpProviderModels('gw', {
      baseUrl: 'https://gw.example/v1',
      overrideOnly: true,
      replaceModels: true,
      models: [],
    });

    expect(result.removedModels).toEqual([]);
    const entry = providersOf(await readModels()).gw ?? {} as unknown as unknown as ProviderEntry;
    expect(entry.models?.map((m) => m.id)).toEqual(['withdrawn', 'kept']);
  });

  test('a listing that only prunes still counts as a write', async () => {
    await Bun.write(modelsPath(), seed);
    const result = await upsertOmpProviderModels('gw', {
      baseUrl: 'https://gw.example/v1',
      apiKey: 'sk-live',
      replaceModels: true,
      models: [{ id: 'kept' }],
    });

    expect(result.written).toBe(true);
    expect(result.addedModels).toEqual([]);
    expect(result.removedModels).toEqual(['withdrawn']);
    const entry = providersOf(await readModels()).gw ?? {} as unknown as unknown as ProviderEntry;
    expect(entry.models?.map((m) => m.id)).toEqual(['kept']);
  });

  test('a listing that matches the file keeps every id', async () => {
    await Bun.write(modelsPath(), seed);
    const result = await upsertOmpProviderModels('gw', {
      baseUrl: 'https://gw.example/v1',
      apiKey: 'sk-live',
      replaceModels: true,
      models: [{ id: 'withdrawn' }, { id: 'kept' }],
    });

    expect(result.addedModels).toEqual([]);
    expect(result.removedModels).toEqual([]);
    const entry = providersOf(await readModels()).gw ?? {} as unknown as unknown as ProviderEntry;
    expect(entry.models?.map((m) => m.id)).toEqual(['withdrawn', 'kept']);
  });
});

describe('removeOmpProvider', () => {
  test('removes the whole entry and reports its model count', async () => {
    await Bun.write(modelsPath(), 'providers:\n  gone:\n    baseUrl: https://x\n    models:\n      - id: a\n      - id: b\n  kept:\n    baseUrl: https://y\n');
    expect(await removeOmpProvider('gone')).toEqual({ removed: true, removedModels: 2 });
    expect(Object.keys(providersOf(await readModels()))).toEqual(['kept']);
  });

  test('a missing provider (or no providers mapping) removes nothing', async () => {
    await Bun.write(modelsPath(), 'theme: dark\n');
    expect(await removeOmpProvider('ghost')).toEqual({ removed: false, removedModels: 0 });
    await Bun.write(modelsPath(), 'providers:\n  other:\n    baseUrl: https://x\n');
    expect(await removeOmpProvider('ghost')).toEqual({ removed: false, removedModels: 0 });
  });
});
