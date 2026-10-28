/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Three small shared modules whose failures are all silent misbehaviour rather
 * than crashes:
 *
 * - `modelKey` is the composite identity every lookup/favorite/preset mutation
 *   keys on. The omp registry serves the same model id from several providers,
 *   so an id-only key highlights or mutates the WRONG provider's row — these
 *   pin the composite shape and the empty result for a missing model.
 * - `catalog`'s fallback lookup must try the provider slug AND the vendor
 *   prefix of a `vendor/id` id, and its loader must degrade to cached/empty
 *   data instead of failing the caller (except when `strict` opts in).
 * - `remote-list` normalizes four different listing spellings; a missed
 *   context field or a Gemini `models/` prefix produces a wrong row.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { modelKey } from '@/shared/lib/models/identity';
import { findCatalogModel, loadModelsDevCatalog } from '@/shared/lib/models/catalog';
import { entryCapabilities, extractModels } from '@/shared/lib/models/remote-list';

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const realFetch = Bun.fetch;

// Bun has no `window`; the catalog cache lives on `globalThis` under this key.
const CATALOG_CACHE_KEY = '__kabmoModelsDevCatalog';
const globalScope = globalThis as unknown as Record<string, unknown>;

let calls: string[] = [];

function stubFetch(handler: (url: string) => Response | Promise<Response>): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  delete globalScope[CATALOG_CACHE_KEY];
});

afterEach(() => {
  delete globalScope[CATALOG_CACHE_KEY];
});

afterAll(() => {
  globalThis.fetch = realFetch;
  delete globalScope[CATALOG_CACHE_KEY];
});

describe('modelKey', () => {
  test('composes provider and id so the same id under two providers differs', () => {
    expect(modelKey({ provider: 'deepseek', id: 'deepseek-v4-pro' })).toBe('deepseek:deepseek-v4-pro');
    expect(modelKey({ provider: 'kenari', id: 'deepseek-v4-pro' })).toBe('kenari:deepseek-v4-pro');
  });

  test('a missing model is the empty key, not "undefined:undefined"', () => {
    // The empty key is what preferences filter out of the favorites list.
    expect(modelKey(null)).toBe('');
    expect(modelKey(undefined)).toBe('');
  });

  test('an empty id still composes, so an id-less row cannot collide with a missing one', () => {
    expect(modelKey({ provider: 'kenari', id: '' })).toBe('kenari:');
  });
});

describe('findCatalogModel', () => {
  const catalog = {
    kenari: { models: { 'deepseek-v4-flash': { name: 'Flash' } } },
    anthropic: { models: { 'anthropic/claude-sonnet-4': { name: 'Sonnet' } } },
    'deepseek-ai': { models: { 'DeepSeek-V4-Flash-0731': { name: 'DeepSeek V4 Flash 0731', reasoning: true, limit: { context: 1_000_000, output: 393_216 }, cost: { input: 0.424, output: 1.272 } } } },
    deepinfra: { models: { 'deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731': { name: 'DeepSeek V4 Flash 0731', canonical_model_id: 'deepseek/deepseek-v4-flash-0731', reasoning: true } } },
    empiriolabs: { models: { 'deepseek-v4-flash-0731': { name: 'DeepSeek V4 Flash 0731', canonical_model_id: 'deepseek/deepseek-v4-flash-0731', limit: { context: 1_000_000 } } } },
    // A provider whose model names look nothing like deepseek — for false-positive guard
    tencent: { models: { 'tencent/Hy3': { name: 'Hy3', reasoning: true } } },
  };

  test('finds a plain id under the given provider slug', () => {
    expect(findCatalogModel(catalog, 'kenari', 'deepseek-v4-flash')).toEqual({
      info: { name: 'Flash' },
      providerKey: 'kenari',
    });
  });

  test('falls back to the vendor prefix of a composite id', () => {
    // OpenRouter lists `anthropic/claude-sonnet-4`; the catalog files it under
    // the `anthropic` provider, not the one the model was fetched from.
    expect(findCatalogModel(catalog, 'custom', 'anthropic/claude-sonnet-4')).toEqual({
      info: { name: 'Sonnet' },
      providerKey: 'anthropic',
    });
  });

  test('tries the bare id after the slash when the full id is not filed', () => {
    const prefixed = { vendor: { models: { 'deepseek-v4-flash': { name: 'Flash' } } } };
    expect(findCatalogModel(prefixed, undefined, 'vendor/deepseek-v4-flash')?.info).toEqual({ name: 'Flash' });
  });

  test('a missing provider slug or model id returns null', () => {
    // Model still found via Level 3 (model name only) despite wrong slug
    expect(findCatalogModel(catalog, 'ghost', 'deepseek-v4-flash')?.info?.name).toBe('Flash');
    expect(findCatalogModel(catalog, 'kenari', 'ghost')).toBeNull();
    expect(findCatalogModel({}, undefined, 'anything')).toBeNull();
  });

  test('the given provider slug is tried before the id-derived vendor', () => {
    const both = {
      custom: { models: { 'anthropic/x': { name: 'Custom' } } },
      anthropic: { models: { 'anthropic/x': { name: 'Anthropic' } } },
    };
    expect(findCatalogModel(both, 'custom', 'anthropic/x')?.providerKey).toBe('custom');
  });

  test('strips :variant suffix before matching (level 1)', () => {
    expect(findCatalogModel(catalog, 'kenari', 'deepseek-v4-flash:netra')).toEqual({
      info: { name: 'Flash' },
      providerKey: 'kenari',
    });
  });

  test('matches PascalCase model name under provider (level 2)', () => {
    // `sumopod/deepseek-v4-flash-0731:netra` → strip variant → `deepseek-v4-flash-0731`
    // Level 1: not under sumopod → Level 2: try provider prefix `sumopod` (not in catalog)
    // No providerSlug given → skip Level 2 explicit provider check
    // But with providerSlug='deepseek-ai' it should match PascalCase
    expect(findCatalogModel(catalog, 'deepseek-ai', 'deepseek-v4-flash-0731:netra')?.info?.name).toBe('DeepSeek V4 Flash 0731');
  });

  test('matches canonical_model_id when provider key differs from model id prefix (level 2 fallback)', () => {
    // deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731 has canonical_model_id
    // Searching with providerSlug='deepinfra' should find it by canonical match
    const result = findCatalogModel(catalog, 'deepinfra', 'deepseek/deepseek-v4-flash-0731');
    expect(result).not.toBeNull();
    expect(result?.providerKey).toBe('deepinfra');
    expect(result?.info?.name).toBe('DeepSeek V4 Flash 0731');
  });

  test('matches model name only ignoring provider prefix (level 3)', () => {
    // `sumopod/deepseek-v4-flash-0731` → cleanId = `sumopod/deepseek-v4-flash-0731`
    // modelName = `deepseek-v4-flash-0731` → should match `empiriolabs/deepseek-v4-flash-0731`
    const result = findCatalogModel(catalog, 'sumopod', 'sumopod/deepseek-v4-flash-0731');
    expect(result).not.toBeNull();
    expect(result?.info?.limit?.context).toBe(1_000_000);
  });

  test('does not false-positive match tencent/Hy3 for sumopod/deepseek (level 4 guard)', () => {
    // Prefix: 'sumopod-deepseek-v4-flash-0731' → segments: ['sumopod','deepseek','v4','flash','0731']
    // Hy3 → ['Hy3']
    // MIN_SEGMENTS_MATCH=2 required: first segment 'sumopod' !== 'Hy3' → 0 segments match → rejected
    const result = findCatalogModel(catalog, undefined, 'sumopod/deepseek-v4-flash-0731:netra');
    // Should NOT match tencent/Hy3
    expect(result?.info?.name).not.toBe('Hy3');
    // But SHOULD find something (empiriolabs/deepseek-v4-flash-0731 via level 3)
    expect(result?.info?.name).toBe('DeepSeek V4 Flash 0731');
  });

  test('returns null for completely unrelated model id', () => {
    expect(findCatalogModel(catalog, undefined, 'foo/bar:baz')).toBeNull();
    expect(findCatalogModel(catalog, undefined, 'something-completely-different')).toBeNull();
  });
});

describe('loadModelsDevCatalog', () => {
  test('fetches once and serves the second call from the in-process cache', async () => {
    stubFetch(() => jsonResponse({ kenari: { models: {} } }));

    const first = await loadModelsDevCatalog();
    const second = await loadModelsDevCatalog();

    expect(calls).toEqual(['https://models.dev/api.json']);
    expect(second).toBe(first);
  });

  test('a non-ok response degrades to an empty catalog', async () => {
    stubFetch(() => jsonResponse({}, 503));

    expect(await loadModelsDevCatalog()).toEqual({});
  });

  test('a non-object payload degrades to an empty catalog', async () => {
    stubFetch(() => jsonResponse(null));

    expect(await loadModelsDevCatalog()).toEqual({});
  });

  test('a transport failure degrades to an empty catalog', async () => {
    stubFetch(() => {
      throw new Error('dns failure');
    });

    expect(await loadModelsDevCatalog()).toEqual({});
  });

  test('strict rethrows the HTTP status instead of degrading', async () => {
    stubFetch(() => jsonResponse({}, 500));

    await expect(loadModelsDevCatalog({ strict: true })).rejects.toThrow('models.dev responded 500');
  });

  test('strict rejects a non-object payload', async () => {
    stubFetch(() => jsonResponse('nope'));

    await expect(loadModelsDevCatalog({ strict: true })).rejects.toThrow('models.dev payload is not an object');
  });

  test('a fresh cache is used even under strict', async () => {
    stubFetch(() => jsonResponse({ kenari: { models: {} } }));
    const data = await loadModelsDevCatalog({ strict: true });

    stubFetch(() => {
      throw new Error('must not be called');
    });
    expect(await loadModelsDevCatalog({ strict: true })).toBe(data);
    expect(calls).toEqual([]);
  });
});

describe('entryCapabilities', () => {
  test('reads capability flags from their several spellings', () => {
    expect(entryCapabilities({ reasoning: true }).hasReasoning).toBe(true);
    expect(entryCapabilities({ reasoning_toggle: true }).hasReasoning).toBe(true);
    expect(entryCapabilities({ tool_call: true }).hasTools).toBe(true);
    expect(entryCapabilities({ modalities: { input: ['text', 'image'] } }).hasVision).toBe(true);
  });

  test('absent signals stay undefined rather than defaulting to false', () => {
    // The callers must be able to tell "unknown" from "not supported".
    const caps = entryCapabilities({});
    expect(caps.hasReasoning).toBeUndefined();
    expect(caps.hasTools).toBeUndefined();
    expect(caps.hasVision).toBeUndefined();
    expect(caps.priceInput).toBeUndefined();
  });

  test('tool_call:false is an explicit false, not undefined', () => {
    expect(entryCapabilities({ tool_call: false }).hasTools).toBe(false);
  });

  test('takes the first positive max-output-token spelling', () => {
    expect(entryCapabilities({ max_output_tokens: 8192 }).maxOutputTokens).toBe(8192);
    expect(entryCapabilities({ max_output_tokens: 0, maxOutputTokens: 4096 }).maxOutputTokens).toBe(4096);
    expect(entryCapabilities({ max_output_tokens: Number.POSITIVE_INFINITY }).maxOutputTokens).toBeUndefined();
  });

  test('USD pricing passes through unchanged', () => {
    const caps = entryCapabilities({ pricing: { input: 1.5, output: 6, currency: 'USD' } });
    expect(caps.priceInput).toBe(1.5);
    expect(caps.priceOutput).toBe(6);
  });

  test('micro-IDR pricing is converted to USD per 1M tokens', () => {
    // Kenari quotes micro-IDR per 1M tokens; 16_500 IDR/USD * 1e6 micro.
    const caps = entryCapabilities({
      pricing: { input: 16_500 * 1_000_000 * 2, output: 16_500 * 1_000_000, unit: 'micro_idr_per_1m_tokens' },
    });
    expect(caps.priceInput).toBe(2);
    expect(caps.priceOutput).toBe(1);
  });

  test('unknown currency or a partial price is dropped entirely', () => {
    expect(entryCapabilities({ pricing: { input: 1, output: 2, currency: 'EUR' } }).priceInput).toBeUndefined();
    expect(entryCapabilities({ pricing: { input: 1 } }).priceInput).toBeUndefined();
  });
});

describe('extractModels', () => {
  test('reads both the data and models envelopes', () => {
    expect(extractModels({ data: [{ id: 'a' }] })?.map((m) => m.id)).toEqual(['a']);
    expect(extractModels({ models: [{ id: 'b' }] })?.map((m) => m.id)).toEqual(['b']);
  });

  test('a payload with neither list is null, not an empty list', () => {
    expect(extractModels({})).toBeNull();
    expect(extractModels(null)).toBeNull();
    expect(extractModels('nope')).toBeNull();
    expect(extractModels({ data: 'not-an-array' })).toBeNull();
  });

  test('an empty list stays an empty array', () => {
    expect(extractModels({ data: [] })).toEqual([]);
  });

  test('strips the Gemini "models/" id prefix', () => {
    const models = extractModels({ models: [{ name: 'models/gemini-2.5-pro' }] });
    expect(models?.[0].id).toBe('gemini-2.5-pro');
  });

  test('prefers display_name, then displayName, then the id', () => {
    const models = extractModels({
      data: [{ id: 'a', display_name: 'Anthropic Style' }, { id: 'b', displayName: 'Gemini Style' }, { id: 'c' }],
    });
    expect(models?.map((m) => m.name)).toEqual(['Anthropic Style', 'Gemini Style', 'c']);
  });

  test('builds the combined context label from context and max output', () => {
    const models = extractModels({
      data: [{ id: 'a', context_window: 1_000_000, max_output_tokens: 384_000 }, { id: 'b', context_length: 131_072 }],
    });
    expect(models?.[0].contextWindow).toBe('1M ctx · 384K out');
    expect(models?.[1].contextWindow).toBe('131.1K ctx');
  });

  test('an entry with no id or name is dropped, and duplicate ids collapse', () => {
    const models = extractModels({
      data: [{ id: 'a' }, { id: 'a', name: 'dup' }, { name: '' }, { context_window: 1000 }],
    });
    expect(models?.map((m) => m.id)).toEqual(['a']);
  });

  test('hasTools defaults true and hasVision defaults false when unstated', () => {
    const models = extractModels({ data: [{ id: 'a' }] });
    expect(models?.[0].hasTools).toBe(true);
    expect(models?.[0].hasVision).toBe(false);
    expect(models?.[0].isVisible).toBe(true);
  });

  test('an explicit tool_call:false wins over the default', () => {
    expect(extractModels({ data: [{ id: 'a', tool_call: false }] })?.[0].hasTools).toBe(false);
  });

  test('non-object entries inside the list are skipped', () => {
    const models = extractModels({ data: [null, 'x', 3, { id: 'ok' }] });
    expect(models?.map((m) => m.id)).toEqual(['ok']);
  });
});