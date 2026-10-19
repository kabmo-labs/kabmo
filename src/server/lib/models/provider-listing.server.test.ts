/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `provider-listing.server.ts` probes a provider endpoint for its model list,
 * and the probe is the one place Kabmo picks a wire dialect on the
 * user's behalf. Each rule here was a real failure mode:
 *
 *  - an Anthropic-shaped endpoint rejects a Bearer header with a 401 that reads
 *    like a bad key, so the dialect must pick `x-api-key` + `anthropic-version`;
 *  - Azure takes a string key as `api-key` and the version as a query
 *    parameter — a Bearer probe there is always a 401;
 *  - Gemini wants the key in the query string;
 *  - a dialect with no listing route at all (Bedrock, Vertex, Codex, the judge
 *    APIs) must return an empty list WITHOUT probing, or a 404 is reported as
 *    if the endpoint were broken;
 *  - with no dialect the three styles are tried in order, and the first
 *    recognizable list wins — that is what makes the picker work for a gateway
 *    nobody classified.
 *
 * A local stub server records the exact headers and URL of every request, so
 * each assertion is about what actually went on the wire.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { enrichFromCatalog, fetchRemoteModels, toOmpSeed } from '@/server/lib/models/provider-listing.server';

/**
 * The runner's own fetch, captured before any test runs: another file in the
 * same `bun test` process may have left a stub on the global, and this file
 * must reach the REAL listener it starts per case.
 */
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const realFetch = Bun.fetch;

interface RecordedRequest {
  url: string;
  headers: Headers;
}

const servers: Bun.Server<undefined>[] = [];
const requests: RecordedRequest[] = [];
const MODELS_BODY = { data: [{ id: 'm1', name: 'M1' }] };

function startServer(respond: (request: Request, index: number) => Response): string {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const index = requests.length;
      requests.push({ url: request.url, headers: new Headers(request.headers) });
      return respond(request, index);
    },
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  requests.length = 0;
  globalThis.__kabmoModelsDevCatalog = undefined;
});

describe('fetchRemoteModels — one dialect, one header set', () => {
  test('anthropic-messages sends x-api-key and anthropic-version, never a Bearer', async () => {
    const base = startServer(() => Response.json(MODELS_BODY));
    const result = await fetchRemoteModels(base, 'sk-ant', 'anthropic-messages');

    expect(result.models?.map((model) => model.id)).toEqual(['m1']);
    expect(result.error).toBe('');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`${base}/models`);
    expect(requests[0].headers.get('x-api-key')).toBe('sk-ant');
    expect(requests[0].headers.get('anthropic-version')).toBe('2023-06-01');
    expect(requests[0].headers.get('authorization')).toBeNull();
  });

  test('a keyless anthropic endpoint still announces the version', async () => {
    const base = startServer(() => Response.json(MODELS_BODY));
    await fetchRemoteModels(base, undefined, 'anthropic-messages');

    expect(requests[0].headers.get('x-api-key')).toBeNull();
    expect(requests[0].headers.get('anthropic-version')).toBe('2023-06-01');
  });

  test('OpenAI-compatible dialects send the Bearer header only', async () => {
    for (const api of ['openai-completions', 'openai-responses'] as const) {
      requests.length = 0;
      const base = startServer(() => Response.json(MODELS_BODY));
      await fetchRemoteModels(base, 'sk-oi', api);

      expect(requests[0].headers.get('authorization')).toBe('Bearer sk-oi');
      expect(requests[0].headers.get('x-api-key')).toBeNull();
    }
  });

  test('gemini carries the key percent-encoded in the query string, with no auth header', async () => {
    const base = startServer(() => Response.json({ models: [{ id: 'models/gemini-2', displayName: 'Gemini 2' }] }));
    const result = await fetchRemoteModels(base, 'a/b+c', 'google-generative-ai');

    expect(result.models?.map((model) => model.id)).toEqual(['gemini-2']);
    expect(requests[0].url).toBe(`${base}/models?key=a%2Fb%2Bc`);
    expect(requests[0].headers.get('authorization')).toBeNull();
    expect(requests[0].headers.get('x-api-key')).toBeNull();
  });

  test('azure sends api-key and api-version, never a Bearer', async () => {
    const base = startServer(() => Response.json(MODELS_BODY));
    await fetchRemoteModels(base, 'azure-key', 'azure-openai-responses');

    expect(requests[0].url).toBe(`${base}/models?api-version=v1`);
    expect(requests[0].headers.get('api-key')).toBe('azure-key');
    expect(requests[0].headers.get('authorization')).toBeNull();
  });

  test('a dialect with no listing route answers an empty list without probing', async () => {
    for (const api of ['bedrock-converse-stream', 'google-vertex', 'openai-codex-responses', 'openrouter-decisions'] as const) {
      const result = await fetchRemoteModels('http://127.0.0.1:1', 'key', api);
      expect(result).toEqual({ models: [], error: '' });
    }
    expect(requests).toHaveLength(0);
  });

  test('trailing slashes on the base url are not doubled', async () => {
    const base = startServer(() => Response.json(MODELS_BODY));
    await fetchRemoteModels(`${base}///`, 'sk', 'openai-completions');
    expect(requests[0].url).toBe(`${base}/models`);
  });
});

describe('fetchRemoteModels — unclassified endpoints and failures', () => {
  test('no dialect tries the Bearer style first and stops at the first hit', async () => {
    const base = startServer(() => Response.json(MODELS_BODY));
    const result = await fetchRemoteModels(base, 'sk-any', undefined);

    expect(result.models?.map((model) => model.id)).toEqual(['m1']);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('authorization')).toBe('Bearer sk-any');
  });

  test('no dialect falls back to the anthropic style when the first body is unrecognizable', async () => {
    const base = startServer((_request, index) => (
      index === 0 ? new Response('not a model list', { status: 200 }) : Response.json(MODELS_BODY)
    ));
    const result = await fetchRemoteModels(base, 'sk-any', undefined);

    expect(result.models?.map((model) => model.id)).toEqual(['m1']);
    expect(requests).toHaveLength(2);
    expect(requests[1].headers.get('x-api-key')).toBe('sk-any');
  });

  test('a keyless unclassified endpoint tries the Bearer style once', async () => {
    const base = startServer(() => new Response('nope', { status: 200 }));
    const result = await fetchRemoteModels(base, undefined, undefined);

    expect(requests).toHaveLength(1);
    expect(result.models).toBeNull();
    expect(result.error).toBe('Failed to fetch models — OpenAI-compatible: unrecognized response format');
  });

  test('a non-2xx response is reported with its status', async () => {
    const base = startServer(() => new Response('unauthorized', { status: 401 }));
    const result = await fetchRemoteModels(base, 'sk-bad', 'openai-completions');

    expect(result.models).toBeNull();
    expect(result.error).toBe('Failed to fetch models — OpenAI-compatible: HTTP 401');
  });

  test('a dead endpoint reports the transport failure without retrying other styles', async () => {
    const base = startServer(() => Response.json(MODELS_BODY));
    servers.pop()?.stop(true);
    const result = await fetchRemoteModels(base, 'sk-any', undefined);

    expect(result.models).toBeNull();
    expect(result.error.startsWith('Failed to fetch models — OpenAI-compatible: ')).toBe(true);
    expect(requests).toHaveLength(0);
  });
});

describe('enrichFromCatalog', () => {
  const catalog = {
    openai: {
      models: {
        'gpt-5': {
          name: 'GPT-5',
          attachment: true,
          reasoning: true,
          tool_call: true,
          limit: { context: 128_000, output: 16_384 },
          cost: { input: 1.25, output: 10, cache_read: 0.125 },
        },
      },
    },
  };

  test('a bare listing entry is filled in from the catalog', async () => {
    globalThis.__kabmoModelsDevCatalog = { data: catalog, expiresAt: Date.now() + 3_600_000 };
    const [model] = await enrichFromCatalog([
      { id: 'gpt-5', name: 'gpt-5', contextWindow: '', hasTools: false, hasVision: false, isVisible: true },
    ], 'openai');

    expect(model.name).toBe('Gpt-5');
    expect(model.contextWindow).toBe('128K ctx · 16K out');
    expect(model.hasVision).toBe(true);
    expect(model.hasReasoning).toBe(true);
    expect(model.hasTools).toBe(true);
    expect(model.priceInput).toBe(1.25);
    expect(model.priceOutput).toBe(10);
    expect(model.priceCacheRead).toBe(0.125);
    expect(model.priceCacheWrite).toBeUndefined();
  });

  test('the provider-reported metadata (context, pricing) survives enrichment', async () => {
    globalThis.__kabmoModelsDevCatalog = { data: catalog, expiresAt: Date.now() + 3_600_000 };
    const [model] = await enrichFromCatalog([
      { id: 'gpt-5', name: 'My GPT', contextWindow: '8K ctx', hasTools: true, hasVision: true, isVisible: true, priceInput: 0.5 },
    ], 'openai');

    expect(model.name).toBe('Gpt-5');
    expect(model.contextWindow).toBe('8K ctx');
    expect(model.priceInput).toBe(0.5);
    expect(model.priceOutput).toBe(10);
  });

  test('an empty catalog leaves the models untouched', async () => {
    globalThis.__kabmoModelsDevCatalog = { data: {}, expiresAt: Date.now() + 3_600_000 };
    const models = [{ id: 'gpt-5', name: 'gpt-5', contextWindow: '', hasTools: false, hasVision: false, isVisible: true }];
    expect(await enrichFromCatalog(models, 'openai')).toBe(models);
  });

  test('a model the catalog does not know is passed through by reference', async () => {
    globalThis.__kabmoModelsDevCatalog = { data: catalog, expiresAt: Date.now() + 3_600_000 };
    const unknown = { id: 'unknown-model', name: 'unknown-model', contextWindow: '', hasTools: false, hasVision: false, isVisible: true };
    const [model] = await enrichFromCatalog([unknown], 'openai');
    expect(model).toBe(unknown);
  });
});

describe('toOmpSeed', () => {
  test('context and output labels parse back to tokens', () => {
    expect(toOmpSeed({
      id: 'm', name: 'm', contextWindow: '1M ctx · 384K out', hasTools: true, hasVision: false, isVisible: true,
    })).toEqual({ id: 'm', contextWindow: 1_000_000, maxTokens: 384_000 });
  });

  test('a cost is seeded only when both sides are known, cache rates defaulting to 0', () => {
    expect(toOmpSeed({
      id: 'm', name: 'm', contextWindow: '', hasTools: true, hasVision: false, isVisible: true,
      priceInput: 1.5, priceOutput: 6,
    })).toEqual({ id: 'm', cost: { input: 1.5, output: 6, cacheRead: 0, cacheWrite: 0 } });

    expect(toOmpSeed({
      id: 'm', name: 'm', contextWindow: '', hasTools: true, hasVision: false, isVisible: true, priceInput: 1.5,
    })).toEqual({ id: 'm' });
  });

  test('a non-finite price never reaches the file', () => {
    expect(toOmpSeed({
      id: 'm', name: 'm', contextWindow: '', hasTools: true, hasVision: false, isVisible: true,
      priceInput: Number.POSITIVE_INFINITY, priceOutput: 6,
    })).toEqual({ id: 'm' });
  });

  test('flags and a distinct name are carried through, the id-only name is dropped', () => {
    expect(toOmpSeed({
      id: 'm', name: 'M', contextWindow: '200K ctx', hasTools: true, hasVision: true, hasReasoning: true, isVisible: true,
    })).toEqual({ id: 'm', name: 'M', reasoning: true, imageInput: true, contextWindow: 200_000 });
  });

  test('an unparseable context label yields no window fields', () => {
    expect(toOmpSeed({
      id: 'm', name: 'm', contextWindow: 'plenty', hasTools: true, hasVision: false, isVisible: true,
    })).toEqual({ id: 'm' });
  });
});
