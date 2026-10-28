/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The provider row builders.
 *
 * Two behaviours here were the panel's most misleading gaps: an unauthenticated
 * provider was not listed at all (so it could not be signed in from the panel
 * that signs providers in), and a model's capabilities were invented rather
 * than read — every row said `hasVision: false` / `hasTools: true`.
 */

import { describe, expect, test } from 'bun:test';
import {
  catalogProviderItem,
  loginProviderItem,
  nativeProviderItem,
  providerModels,
  type CredentialContext,
} from '@/server/lib/models/provider-items.server';
import type { CatalogModel } from '@/server/lib/models/catalog.server';

const credentials: CredentialContext = {
  modelsYmlKeys: new Set(),
  originOf: () => undefined,
};

function catalogModel(overrides: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    name: overrides.id,
    provider: 'gateway',
    kind: 'chat',
    selector: `gateway/${overrides.id}`,
    input: ['text'],
    ...overrides,
  };
}

describe('loginProviderItem', () => {
  test('an unauthenticated provider is listed, not filtered out', () => {
    // omp's own /models hub lists these dimmed under "Not signed in"; filtering
    // them out made an OAuth provider that had never been signed in unreachable.
    const item = loginProviderItem(
      { id: 'anthropic', name: 'Anthropic', available: true, authenticated: false },
      { disabled: false, credentials },
    );

    expect(item.status).toBe('disconnected');
    expect(item.oauth).toBe(true);
    expect(item.credentialOrigin).toBeUndefined();
  });

  test('a stored OAuth credential is named as a login', () => {
    const item = loginProviderItem(
      { id: 'anthropic', name: 'Anthropic', available: true, authenticated: true },
      { disabled: false, credentials: { ...credentials, originOf: () => 'login' } },
    );

    expect(item.status).toBe('connected');
    expect(item.credentialOrigin).toBe('login');
  });

  test('a disabled provider reports disconnected whatever its credential says', () => {
    const item = loginProviderItem(
      { id: 'anthropic', name: 'Anthropic', available: true, authenticated: true },
      { disabled: true, credentials },
    );
    expect(item.status).toBe('disconnected');
    expect(item.disabled).toBe(true);
  });

  test('its models come from the catalog, including non-chat kinds', () => {
    const item = loginProviderItem(
      { id: 'gateway', name: 'Gateway', available: true, authenticated: true },
      {
        disabled: false,
        credentials,
        catalog: [
          catalogModel({ id: 'chat-x' }),
          catalogModel({ id: 'embed-x', kind: 'embedding', input: [] }),
        ],
      },
    );

    expect(item.models.map((model) => model.id)).toEqual(['chat-x', 'embed-x']);
    expect(item.models[1].kind).toBe('embedding');
  });
});

describe('nativeProviderItem', () => {
  test('capabilities come from the record, not from a default', () => {
    const item = nativeProviderItem(
      {
        slug: 'local',
        baseUrl: 'http://localhost:1234/v1',
        modelIds: ['vision-x', 'plain'],
        models: [
          { id: 'vision-x', imageInput: true, reasoning: true, supportsTools: true },
          { id: 'plain', supportsTools: false },
        ],
      },
      false,
      undefined,
      undefined,
      credentials,
    );

    const vision = item.models.find((model) => model.id === 'vision-x');
    const plain = item.models.find((model) => model.id === 'plain');
    expect(vision?.hasVision).toBe(true);
    expect(vision?.hasReasoning).toBe(true);
    expect(plain?.hasVision).toBe(false);
    // A model that declares no tool support must not claim it.
    expect(plain?.hasTools).toBe(false);
  });

  test('carries the entry fields the panel shows', () => {
    const item = nativeProviderItem(
      {
        slug: 'gateway',
        baseUrl: 'https://x/v1',
        api: 'anthropic-messages',
        auth: 'none',
        discovery: 'lm-studio',
        headers: { 'X-Route': 'a' },
        transport: 'pi-native',
        modelIds: [],
        models: [],
      },
      false,
      undefined,
      undefined,
      credentials,
    );

    expect(item.api).toBe('anthropic-messages');
    expect(item.auth).toBe('none');
    expect(item.discovery).toBe('lm-studio');
    expect(item.headers).toEqual({ 'X-Route': 'a' });
    expect(item.transport).toBe('pi-native');
    expect(item.inModelsYml).toBe(true);
  });
});

describe('providerModels', () => {
  test('the union keeps a registered id the catalog does not serve', () => {
    // A model whose credential lapsed, or one omp filters out of the listing,
    // still exists in models.yml — dropping it read as "deleted".
    const models = providerModels(
      { name: 'gateway', slug: 'gateway' },
      [catalogModel({ id: 'from-catalog', contextWindow: 1000 })],
      [{ id: 'file-only' }],
    );

    expect(models.map((model) => model.id)).toEqual(['from-catalog', 'file-only']);
  });

  test('a catalog row wins over the file entry for the same id', () => {
    const models = providerModels(
      { name: 'gateway', slug: 'gateway' },
      [catalogModel({ id: 'shared', contextWindow: 200000 })],
      [{ id: 'shared', contextWindow: 4096 }],
    );

    expect(models).toHaveLength(1);
    expect(models[0].contextWindow).toContain('200K');
  });

  test('the overlay supplies visibility and saved knobs', () => {
    const models = providerModels(
      { name: 'gateway', slug: 'gateway' },
      [catalogModel({ id: 'a' }), catalogModel({ id: 'b' })],
      [],
      new Map([
        ['a', { isVisible: false }],
        ['b', { isVisible: true, maxTokens: 4096 }],
      ]),
    );

    expect(models.find((model) => model.id === 'a')?.isVisible).toBe(false);
    expect(models.find((model) => model.id === 'b')?.maxTokens).toBe(4096);
  });
});

describe('catalogProviderItem', () => {
  test('a discovered keyless endpoint gets a row of its own', () => {
    // Its models reach the chat picker, so the panel that manages providers has
    // to list it — it appeared in neither get_login_providers nor models.yml.
    const item = catalogProviderItem(
      'ollama',
      [catalogModel({ id: 'llama3', provider: 'ollama' })],
      undefined,
    );

    expect(item.slug).toBe('ollama');
    expect(item.status).toBe('connected');
    expect(item.models.map((model) => model.id)).toEqual(['llama3']);
  });
});
