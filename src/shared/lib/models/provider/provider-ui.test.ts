/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider sidebar's three client-side helpers. Each has a silent wrong
 * outcome: a mis-titled slug draws the wrong provider name, the legacy-Kenari
 * sweep either leaves two bogus fallback rows in the picker or (worse) deletes
 * a real model that happens to share the id shape, and a provider write that
 * notifies the picker BEFORE the server confirms re-caches the pre-mutation
 * list for another 60 seconds.
 */

import { afterAll, describe, expect, test } from 'bun:test';

import { fetchModelsData, invalidateModelsCache } from '@/shared/lib/models/client';

import {
  providerLabel,
  providerNamesFromConnected,
  titleCaseProviderSlug,
} from '@/shared/lib/models/provider/label';
import { isKenariProvider, removeLegacyKenariModels } from '@/shared/lib/models/provider/cleanup';
import {
  deleteProvider,
  saveProviderOverlay,
  setProviderEnabled,
} from '@/shared/lib/models/provider/connection';
import type { ProviderItem, ProviderModel } from '@/shared/types';

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const realFetch = Bun.fetch;

let calls: Array<{ url: string; init: RequestInit }> = [];
/** How many times a read of the model catalog actually reached the network. */
let modelReads = 0;

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  calls = [];
  modelReads = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    if (url.includes('/api/models')) {
      modelReads += 1;
      return jsonResponse({ models: {}, providers: {} });
    }
    return handler(url, init ?? {});
  }) as typeof fetch;
}

/**
 * Whether a write dropped the picker's cache.
 *
 * The window event this used to assert is gone: the SERVER republishes the
 * `models` topic on the same write, and the client's half is to stop answering
 * from its own 60s cache. Asserted behaviourally — a primed cache answers
 * locally, and a notified one does not.
 */
async function cacheDroppedBy(mutate: () => Promise<unknown>): Promise<boolean> {
  invalidateModelsCache();
  await fetchModelsData();
  modelReads = 0;
  await mutate();
  await fetchModelsData();
  return modelReads === 1;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function provider(overrides: Partial<ProviderItem> & { slug: string }): ProviderItem {
  return {
    id: `id-${overrides.slug}`,
    name: overrides.slug,
    icon: overrides.slug,
    status: 'connected',
    configuredIn: 'models.yml',
    ...overrides,
  } as ProviderItem;
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
  // `fetchModelsData` caches the answer for 60s on `globalThis`, so the stub
  // above stays cached after this file ends. Measured: `model-dropdown/
  // refresh.test.tsx` then read `{models:{}, modelList:[]}` from the cache on
  // its FIRST render and failed "expected to contain Alpha Model" — a failure
  // in a suite this file does not name, reproduced on the tree before this
  // change. Dropping it is the whole hand-off.
  invalidateModelsCache();
});

describe('titleCaseProviderSlug', () => {
  test('title-cases the first letter of each separator-delimited word', () => {
    expect(titleCaseProviderSlug('kenari')).toBe('Kenari');
    expect(titleCaseProviderSlug('command-code')).toBe('Command Code');
    expect(titleCaseProviderSlug('openai_codex')).toBe('Openai Codex');
    expect(titleCaseProviderSlug('llama.cpp server')).toBe('Llama.cpp Server');
  });

  test('only the first letter is raised — interior capitals are preserved', () => {
    expect(titleCaseProviderSlug('openAI')).toBe('OpenAI');
  });

  test('collapses runs of separators and drops empty words', () => {
    expect(titleCaseProviderSlug('a--b__c  d')).toBe('A B C D');
    expect(titleCaseProviderSlug('  spaced  ')).toBe('Spaced');
  });

  test('an empty or whitespace-only slug returns an empty label', () => {
    // Callers omit the provider metadata item on an empty label.
    expect(titleCaseProviderSlug('')).toBe('');
    expect(titleCaseProviderSlug('   ')).toBe('');
  });
});

describe('providerLabel', () => {
  test('prefers the connected-provider display name for the exact slug', () => {
    expect(providerLabel('kenari', { kenari: 'Kenari AI' })).toBe('Kenari AI');
  });

  test('falls back to the title-cased slug when the map has no entry', () => {
    expect(providerLabel('command-code', { other: 'Other' })).toBe('Command Code');
    expect(providerLabel('kenari')).toBe('Kenari');
  });

  test('a blank stored name falls back to the title-cased slug', () => {
    expect(providerLabel('kenari', { kenari: '   ' })).toBe('Kenari');
    expect(providerLabel('kenari', { kenari: '' })).toBe('Kenari');
  });

  test('an empty slug is empty regardless of the map', () => {
    expect(providerLabel('', { '': 'Nope' })).toBe('');
    expect(providerLabel('  ')).toBe('');
  });
});

describe('providerNamesFromConnected', () => {
  test('maps id to display name, skipping unnamed rows', () => {
    const names = providerNamesFromConnected([
      { id: 'kenari', name: 'Kenari AI', disabled: false },
      { id: 'ghost', name: '  ', disabled: true },
      { id: 'openai', name: 'OpenAI', disabled: false },
    ]);

    expect(names).toEqual({ kenari: 'Kenari AI', openai: 'OpenAI' });
  });

  test('an absent or empty list yields an empty map', () => {
    expect(providerNamesFromConnected(undefined)).toEqual({});
    expect(providerNamesFromConnected([])).toEqual({});
  });
});

describe('isKenariProvider', () => {
  test('matches the slug, name or baseUrl case-insensitively', () => {
    expect(isKenariProvider(provider({ slug: 'kenari' }))).toBe(true);
    expect(isKenariProvider(provider({ slug: 'custom', name: 'KENARI Gateway' }))).toBe(true);
    expect(isKenariProvider(provider({ slug: 'custom', baseUrl: 'https://api.kenari.dev/v1' }))).toBe(true);
  });

  test('rejects providers with no Kenari identity', () => {
    expect(isKenariProvider(provider({ slug: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' }))).toBe(false);
    // `baseUrl` is optional: a missing endpoint must not throw.
    expect(isKenariProvider(provider({ slug: 'local', name: 'Local' }))).toBe(false);
  });
});

describe('removeLegacyKenariModels', () => {
  const kenari = provider({ slug: 'kenari' });

  test('drops the two legacy fallback rows and keeps everything else', () => {
    const models = [
      model({ id: 'model-1-1', name: 'Kenari Default Model' }),
      model({ id: 'model-9-2', name: 'Kenari Fast / Flash' }),
      model({ id: 'real-model', name: 'Kenari Default Model' }),
    ];

    expect(removeLegacyKenariModels(kenari, models).map((m) => m.id)).toEqual(['real-model']);
  });

  test('the id shape alone is not enough — the name must match too', () => {
    // A user-registered model that merely reuses the `model-N-1/2` id is kept.
    const models = [model({ id: 'model-1-1', name: 'My Own Model' })];
    expect(removeLegacyKenariModels(kenari, models)).toHaveLength(1);
  });

  test('the legacy name alone is not enough — the id shape must match too', () => {
    const models = [model({ id: 'kenari-default', name: 'Kenari Default Model' })];
    expect(removeLegacyKenariModels(kenari, models)).toHaveLength(1);
  });

  test('only the -1/-2 suffixes are legacy', () => {
    const models = [
      model({ id: 'model-1-3', name: 'Kenari Default Model' }),
      model({ id: 'model-x-1', name: 'Kenari Default Model' }),
    ];
    expect(removeLegacyKenariModels(kenari, models)).toHaveLength(2);
  });

  test('a non-Kenari provider is returned untouched, by reference', () => {
    const models = [model({ id: 'model-1-1', name: 'Kenari Default Model' })];
    const result = removeLegacyKenariModels(provider({ slug: 'openai' }), models);
    expect(result).toBe(models);
  });
});

describe('saveProviderOverlay / setProviderEnabled', () => {
  test('the overlay is POSTed verbatim and returns the server list', async () => {
    const providers = [provider({ slug: 'kenari' })];
    stubFetch(() => jsonResponse({ providers }));

    const result = await saveProviderOverlay(providers);

    expect(calls[0].url).toBe('/api/settings/providers');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ providers });
    expect(result).toEqual(providers);
  });

  test('a successful overlay write drops the picker cache', async () => {
    stubFetch(() => jsonResponse({ providers: [] }));
    expect(await cacheDroppedBy(() => saveProviderOverlay([]))).toBe(true);
  });

  test('enable/disable send the slug under the right key', async () => {
    stubFetch(() => jsonResponse({ providers: [] }));

    await setProviderEnabled('kenari', true);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ enableProvider: 'kenari' });

    await setProviderEnabled('kenari', false);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ disableProvider: 'kenari' });
  });

  test('a response with no providers array resolves to null, not an error', async () => {
    stubFetch(() => jsonResponse({}));

    expect(await saveProviderOverlay([])).toBeNull();
  });

  test('a non-ok response throws the server error before notifying', async () => {
    stubFetch(() => jsonResponse({ error: 'overlay rejected' }, 400));

    await expect(saveProviderOverlay([])).rejects.toThrow('overlay rejected');
    expect(await cacheDroppedBy(() => saveProviderOverlay([]).catch(() => null))).toBe(false);
  });

  test('a non-ok response without an error names the HTTP status', async () => {
    stubFetch(() => jsonResponse({}, 500));

    await expect(setProviderEnabled('x', true)).rejects.toThrow('Providers request failed (HTTP 500)');
  });
});

describe('deleteProvider', () => {
  test('deletes by URL-encoded id and notifies on success', async () => {
    stubFetch(() => jsonResponse({ ok: true, removedFromOmp: true, modelsRemoved: 3 }));

    const result = await deleteProvider('id kenari/1');

    expect(calls[0].url).toBe('/api/settings/providers?id=id%20kenari%2F1');
    expect(calls[0].init.method).toBe('DELETE');
    expect(result).toEqual({ ok: true, removedFromOmp: true, modelsRemoved: 3 });
  });

  test('a successful delete drops the picker cache', async () => {
    stubFetch(() => jsonResponse({ ok: true }));
    expect(await cacheDroppedBy(() => deleteProvider('id-1'))).toBe(true);
  });

  test('a warning about a partial cleanup is surfaced, not swallowed', async () => {
    stubFetch(() => jsonResponse({ ok: true, warning: 'models.yml cleanup failed' }));

    const result = await deleteProvider('id-1');

    expect(result.ok).toBe(true);
    expect(result.warning).toBe('models.yml cleanup failed');
  });

  test('a non-ok response becomes an error envelope without notifying', async () => {
    stubFetch(() => jsonResponse({ error: 'not found' }, 404));

    expect(await deleteProvider('id-1')).toEqual({ ok: false, error: 'not found' });
    expect(await cacheDroppedBy(() => deleteProvider('id-1'))).toBe(false);
  });

  test('a non-ok response without an error names the HTTP status', async () => {
    stubFetch(() => jsonResponse({}, 503));

    expect(await deleteProvider('id-1')).toEqual({ ok: false, error: 'Delete failed (HTTP 503)' });
  });

  test('a transport failure becomes an error envelope', async () => {
    stubFetch(() => {
      throw new Error('connection reset');
    });

    expect(await deleteProvider('id-1')).toEqual({ ok: false, error: 'connection reset' });
  });

  test('a non-Error rejection uses the generic delete message', async () => {
    stubFetch(() => {
      throw null;
    });

    expect(await deleteProvider('id-1')).toEqual({ ok: false, error: 'Network error while deleting the provider' });
  });
});
