/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider-models client is the write path into `models.yml`. Its failure
 * modes are destructive in both directions: a REPLACE must not lose the user's
 * hand-edited per-model config for an id the endpoint still serves, and must
 * not keep an id it no longer serves — while the fetch/add requests must turn a
 * broken server response into a `{ ok: false }`/`{ success: false }` envelope
 * instead of a rejected promise, since a thrown error would leave the settings
 * dialog stuck with no message. The catalog sync's defaults are pinned too,
 * because a model registered without a context label silently renders as the
 * wrong size in the picker.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { fetchModelsData, notifyModelsUpdated } from '@/shared/lib/models/client';

import {
  addProviderModel,
  fetchProviderModelsRemote,
  replaceProviderModels,
  syncProviderModelsToCatalog,
} from '@/shared/lib/models/provider/models';
import type { ProviderModel } from '@/shared/types';

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const realFetch = Bun.fetch;

let calls: Array<{ url: string; init: RequestInit }> = [];

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function model(overrides: Partial<ProviderModel> & { id: string }): ProviderModel {
  return {
    name: overrides.id,
    contextWindow: '',
    hasTools: true,
    hasVision: false,
    isVisible: true,
    ...overrides,
  };
}

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('replaceProviderModels', () => {
  test('the fetched list becomes the model list, in fetched order', () => {
    const existing = [model({ id: 'a' }), model({ id: 'b' })];
    const result = replaceProviderModels(existing, [model({ id: 'c' }), model({ id: 'b' })]);

    expect(result.models.map((m) => m.id)).toEqual(['c', 'b']);
    expect(result.added.map((m) => m.id)).toEqual(['c']);
    expect(result.addedCount).toBe(1);
  });

  test('drops ids the endpoint no longer serves', () => {
    // The whole point of a fetch: the endpoint's answer IS the list. An
    // add-only merge left every withdrawn id in the panel.
    const result = replaceProviderModels([model({ id: 'gone' }), model({ id: 'kept' })], [model({ id: 'kept' })]);

    expect(result.models.map((m) => m.id)).toEqual(['kept']);
    expect(result.removed).toEqual(['gone']);
    expect(result.removedCount).toBe(1);
    expect(result.addedCount).toBe(0);
  });

  test('the user\'s per-model choices survive on the ids that stay', () => {
    // Visibility and sampling config live on the previous objects; a rebuilt
    // copy would silently reset the user's edits.
    const existing = [model({ id: 'a', isVisible: false, maxTokens: 4096, reasoningEffort: 'high' })];
    const result = replaceProviderModels(existing, [model({ id: 'a', name: 'A Fresh' })]);

    expect(result.models[0].isVisible).toBe(false);
    expect(result.models[0].maxTokens).toBe(4096);
    expect(result.models[0].reasoningEffort).toBe('high');
    // The fetched metadata still wins where it exists.
    expect(result.models[0].name).toBe('A Fresh');
  });

  test('a fresh entry carries no leftover config', () => {
    const result = replaceProviderModels([], [model({ id: 'a' })]);
    expect(result.models[0].maxTokens).toBeUndefined();
    expect(result.models[0].temperature).toBeUndefined();
  });

  test('skips entries with no id and duplicates inside the fetched list', () => {
    const result = replaceProviderModels([model({ id: 'a' })], [model({ id: '' }), model({ id: 'b' }), model({ id: 'b' })]);

    expect(result.models.map((m) => m.id)).toEqual(['b']);
    expect(result.addedCount).toBe(1);
    // `a` is not in the fetched list, so it leaves with the replace.
    expect(result.removed).toEqual(['a']);
  });

  test('an empty fetched list empties the provider', () => {
    const result = replaceProviderModels([model({ id: 'a' })], []);
    expect(result.models).toEqual([]);
    expect(result.removed).toEqual(['a']);
    expect(result.removedCount).toBe(1);
  });
});

describe('fetchProviderModelsRemote', () => {
  test('POSTs the request verbatim and returns the parsed result', async () => {
    const payload = { ok: true, models: [model({ id: 'x' })] };
    stubFetch(() => jsonResponse(payload));

    const request = { baseUrl: 'https://api.example/v1', apiKey: 'sk-1', api: 'anthropic-messages' as const };
    const result = await fetchProviderModelsRemote(request);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/settings/provider-models');
    expect(calls[0].init.method).toBe('POST');
    expect(new Headers(calls[0].init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(calls[0].init.body))).toEqual(request);
    expect(result).toEqual(payload);
  });

  test('a non-ok response carries the server error', async () => {
    stubFetch(() => jsonResponse({ ok: false, error: 'bad key' }, 401));

    expect(await fetchProviderModelsRemote({ baseUrl: 'x' })).toEqual({ ok: false, error: 'bad key' });
  });

  test('a non-ok response without an error falls back to the HTTP status', async () => {
    stubFetch(() => jsonResponse({}, 502));

    expect(await fetchProviderModelsRemote({ baseUrl: 'x' })).toEqual({
      ok: false,
      error: 'Request failed (HTTP 502)',
    });
  });

  test('a transport failure becomes an error envelope, not a rejection', async () => {
    stubFetch(() => {
      throw new Error('offline');
    });

    expect(await fetchProviderModelsRemote({ baseUrl: 'x' })).toEqual({ ok: false, error: 'offline' });
  });

  test('a non-Error rejection uses the generic network message', async () => {
    stubFetch(() => {
      throw 'boom';
    });

    expect(await fetchProviderModelsRemote({ baseUrl: 'x' })).toEqual({
      ok: false,
      error: 'Network error while fetching models',
    });
  });
});

describe('notifyModelsUpdated', () => {
  test('drops the client cache, so the next read goes back to the server', async () => {
    // The window event this used to dispatch is gone: the SERVER republishes
    // the `models` topic (see `invalidateModelsCaches`), and the client's half
    // is to stop answering from its own 60s cache. Asserted behaviourally: a
    // primed cache answers locally, and a notified one does not.
    let reads = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/models')) reads += 1;
      return jsonResponse({ models: {}, providers: {} });
    }) as typeof fetch;

    await fetchModelsData();
    reads = 0;
    await fetchModelsData();
    expect(reads).toBe(0);

    notifyModelsUpdated();
    await fetchModelsData();
    expect(reads).toBe(1);
  });
});

describe('addProviderModel', () => {
  test('notifies the picker only after a successful write', async () => {
    stubFetch(() => jsonResponse({ success: true, written: true, addedModels: ['m1'] }));

    const result = await addProviderModel({ provider: 'p', id: 'm1' });

    expect(calls[0].url).toBe('/api/settings/provider-model');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ provider: 'p', id: 'm1' });
    expect(result).toEqual({ success: true, written: true, addedModels: ['m1'] });
    });

  test('a non-ok response is downgraded to success:false without notifying', async () => {
    stubFetch(() => jsonResponse({ success: true, written: true, error: 'nope' }, 400));

    const result = await addProviderModel({ provider: 'p', id: 'm1' });

    expect(result).toEqual({ success: false, written: false, error: 'nope' });
  });

  test('a rejection reason is surfaced as the error when no error field exists', async () => {
    stubFetch(() => jsonResponse({ success: false, written: false, reason: 'already known' }, 409));

    expect(await addProviderModel({ provider: 'p', id: 'm1' })).toEqual({
      success: false,
      written: false,
      reason: 'already known',
      error: 'already known',
    });
  });

  test('a transport failure becomes success:false with the message', async () => {
    stubFetch(() => {
      throw new Error('socket closed');
    });

    expect(await addProviderModel({ provider: 'p', id: 'm1' })).toEqual({
      success: false,
      written: false,
      error: 'socket closed',
    });
  });

  test('a non-Error rejection uses the generic add message', async () => {
    stubFetch(() => {
      throw 42;
    });

    expect(await addProviderModel({ provider: 'p', id: 'm1' })).toEqual({
      success: false,
      written: false,
      error: 'Network error while adding the model',
    });
  });
});

describe('syncProviderModelsToCatalog', () => {
  test('registers each model with the catalog defaults', async () => {
    stubFetch(() => jsonResponse({ ok: true }));

    await syncProviderModelsToCatalog('kenari', [
      model({ id: 'm1', name: 'Model One', contextWindow: '128K ctx · 32K out' }),
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/models');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      actionType: 'addModel',
      model: {
        id: 'm1',
        name: 'Model One',
        provider: 'kenari',
        contextWindow: '128K',
        thinkingLevel: 'Default',
        capabilities: ['Tool calling', 'Reasoning'],
        inputFormats: ['text'],
        outputFormats: ['text'],
      },
    });
    // The sync wrote, so the cache must be dropped: the read goes to the server.
    });

  test('a missing context label falls back to 128K', async () => {
    stubFetch(() => jsonResponse({ ok: true }));

    await syncProviderModelsToCatalog('p', [model({ id: 'm1', contextWindow: '' })]);

    expect(JSON.parse(String(calls[0].init.body)).model.contextWindow).toBe('128K');
  });

  test('one POST per model', async () => {
    stubFetch(() => jsonResponse({ ok: true }));

    await syncProviderModelsToCatalog('p', [model({ id: 'a' }), model({ id: 'b' })]);

    expect(calls.map((call) => JSON.parse(String(call.init.body)).model.id).sort()).toEqual(['a', 'b']);
  });

  test('a failed sync is swallowed so the caller still completes', async () => {
    // The module logs the failure; silence it so the suite output stays clean.
    const realError = console.error;
    console.error = () => {};
    try {
      stubFetch(() => {
        throw new Error('down');
      });

        await syncProviderModelsToCatalog('p', [model({ id: 'm1' })]);
    } finally {
      console.error = realError;
    }

  });
});
