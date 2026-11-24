/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Registered GitHub repositories: what a refresh caches, and what the pane reads
 * back out of that cache.
 *
 * The network is stubbed at `globalThis.fetch` — the module under test is the
 * one that decides WHICH URL to ask, so the test asserts that decision (raw
 * `HEAD` of the two catalog paths) as well as the parse. The cases that matter
 * are the ones a wrong implementation would hide: a repository with no catalog
 * still offers itself, a failed read KEEPS the previous offers instead of
 * emptying the pane, and an offer is marked installed even when the plugin's
 * manifest id differs from the name its repository name suggests.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { findRegistryOffer, readRegistryOffers, readRegistrySources } from '@/server/lib/panels/registries.server';
import { getRegistryCachePath } from '@/server/lib/panels/registry-cache.server';
import {
  pruneRegistryCache,
  refreshPluginRegistries,
  refreshPluginRegistry,
} from '@/server/lib/panels/registry-refresh.server';

let root = '';
const realFetch = globalThis.fetch;
let requested: string[] = [];

/** Serve a JSON body per URL; any other URL answers 404. */
function stubFetch(routes: Record<string, unknown>): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requested.push(url);
    const body = routes[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function writeCatalog(registries: unknown[]): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    join(root, 'marketplace.json'),
    JSON.stringify({ name: 'Kabmo', plugins: [], registries }),
  );
}

const RAW = (repo: string, path: string) => `https://raw.githubusercontent.com/${repo}/HEAD/${path}`;

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-registries-'));
  process.env.KABMO_MARKETPLACE_DIR = root;
  requested = [];
  invalidatePanelScan();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KABMO_MARKETPLACE_DIR;
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('refreshPluginRegistry', () => {
  test("caches the repository's own catalog offers, and names the entries it cannot offer", async () => {
    writeCatalog([{ repo: 'acme/kabmo-plugins-index' }]);
    stubFetch({
      [RAW('acme/kabmo-plugins-index', 'marketplace.json')]: {
        name: 'Acme plugins',
        description: 'Panels by Acme.',
        plugins: [
          { name: 'kanban', source: 'https://github.com/acme/kabmo-plugins-kanban', version: '1.2.0' },
          { name: 'nested', source: 'plugins/nested' },
        ],
      },
    });

    expect((await refreshPluginRegistry('acme/kabmo-plugins-index')).ok).toBe(true);
    // The raw HEAD URL, tried in the documented order.
    expect(requested[0]).toBe(RAW('acme/kabmo-plugins-index', 'marketplace.json'));

    const offers = await readRegistryOffers(new Set(), new Set());
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      pluginId: 'kanban',
      url: 'https://github.com/acme/kabmo-plugins-kanban',
      version: '1.2.0',
      origin: 'git',
      installed: false,
    });

    const [source] = await readRegistrySources();
    expect(source).toMatchObject({
      repo: 'acme/kabmo-plugins-index',
      pluginCount: 1,
      description: 'Panels by Acme.',
    });
    // A relative source is reported, not silently dropped.
    expect(source.warning).toContain('"nested" names a directory inside');
  });

  test('a repository with no catalog offers itself, named without the prefix', async () => {
    writeCatalog([{ repo: 'acme/kabmo-plugins-kanban' }]);
    stubFetch({});

    expect((await refreshPluginRegistry('acme/kabmo-plugins-kanban')).ok).toBe(true);
    // Both candidate paths were asked, in order, before falling back.
    expect(requested).toEqual([
      RAW('acme/kabmo-plugins-kanban', 'marketplace.json'),
      RAW('acme/kabmo-plugins-kanban', '.omp-plugin/marketplace.json'),
    ]);

    const offers = await readRegistryOffers(new Set(), new Set());
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      pluginId: 'kanban',
      name: 'kanban',
      url: 'https://github.com/acme/kabmo-plugins-kanban',
    });
  });

  test("a failed read keeps the previous offers and reports the reason", async () => {
    writeCatalog([{ repo: 'acme/kabmo-plugins-kanban' }]);
    stubFetch({});
    await refreshPluginRegistry('acme/kabmo-plugins-kanban');
    expect(await readRegistryOffers(new Set(), new Set())).toHaveLength(1);

    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND raw.githubusercontent.com');
    }) as unknown as typeof fetch;
    const failed = await refreshPluginRegistry('acme/kabmo-plugins-kanban');
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('ENOTFOUND');

    // The registration and its offers survive: the pane says why, it does not
    // pretend the repository publishes nothing.
    const [source] = await readRegistrySources();
    expect(source.error).toContain('ENOTFOUND');
    expect(source.pluginCount).toBe(1);
    expect(await readRegistryOffers(new Set(), new Set())).toHaveLength(1);
  });

  test('refuses a repository that does not follow the naming rule', async () => {
    writeCatalog([]);
    const result = await refreshPluginRegistry('acme/kanban');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('kabmo-plugins-');
    // Nothing was requested: the rule is checked before the network.
    expect(requested).toEqual([]);
  });

  test('a partial refresh names the repository that failed and keeps the one that answered', async () => {
    writeCatalog([{ repo: 'acme/kabmo-plugins-a' }, { repo: 'acme/kabmo-plugins-b' }]);
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('kabmo-plugins-b')) throw new Error('connect ETIMEDOUT');
      return new Response(JSON.stringify({ plugins: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await refreshPluginRegistries();
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('kabmo-plugins-b');
    // The one that answered is cached; the failed one keeps a row with no offers.
    const sources = await readRegistrySources();
    expect(sources.map((source) => source.pluginCount)).toEqual([1, 0]);
  });
});

describe('reading the cache', () => {
  test('an offer is installed when the CLONE came from its repository, whatever the manifest id', async () => {
    writeCatalog([{ repo: 'acme/kabmo-plugins-kanban' }]);
    stubFetch({});
    await refreshPluginRegistry('acme/kabmo-plugins-kanban');

    // The clone's origin is the `.git` spelling; the manifest id differs from
    // the name the repository name suggests.
    const offers = await readRegistryOffers(new Set(['kanban-board']), new Set(['acme/kabmo-plugins-kanban']));
    expect(offers[0]?.installed).toBe(true);
  });

  test('a bare plugin name resolves to the repository it is offered from', async () => {
    writeCatalog([{ repo: 'acme/kabmo-plugins-kanban' }]);
    stubFetch({});
    await refreshPluginRegistry('acme/kabmo-plugins-kanban');

    expect((await findRegistryOffer('Kanban'))?.url).toBe('https://github.com/acme/kabmo-plugins-kanban');
    expect(await findRegistryOffer('nope')).toBeUndefined();
  });

  test('a registration with no cached read shows zero plugins rather than an error', async () => {
    writeCatalog([{ repo: 'acme/kabmo-plugins-kanban', name: 'Kanban' }]);
    const [source] = await readRegistrySources();
    expect(source).toMatchObject({ repo: 'acme/kabmo-plugins-kanban', name: 'Kanban', pluginCount: 0 });
    expect(source.error).toBeUndefined();
    expect(source.fetchedAt).toBeUndefined();
  });

  test('pruning a registration drops its cached offers', async () => {
    writeCatalog([{ repo: 'acme/kabmo-plugins-kanban' }]);
    stubFetch({});
    await refreshPluginRegistry('acme/kabmo-plugins-kanban');
    expect(fs.existsSync(getRegistryCachePath())).toBe(true);

    await pruneRegistryCache('acme/kabmo-plugins-kanban');
    expect(await readRegistryOffers(new Set(), new Set())).toEqual([]);
  });
});
