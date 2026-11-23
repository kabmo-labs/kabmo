/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The whole server half, on a real plugin: build → load → call → dispose.
 *
 * The fixture is the bundled example, COPIED into a temp marketplace and built
 * there, because that is the only path that exercises what a real install does.
 * A test that imported `server.ts` directly would skip the build, the manifest
 * resolution and the registry's own admission — which is where the failures
 * this suite exists for actually live.
 *
 * The environment override (`KABMO_MARKETPLACE_DIR`) is the seam: the
 * registry resolves the working marketplace from it, so the test never touches
 * the developer's own `~/.kabmo`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, rm } from 'fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'os';
import { isAbsolute, join } from 'path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { packageDir } from '@/server/lib/fs/package-root';
import { invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { buildPanelPlugin } from '@/server/lib/panels/build.server';
import { toManifest } from '@/server/lib/panels/manifest';
import {
  loadPluginServer,
  disposePlugin,
  loadedPluginIds,
  pluginLoadErrors,
} from '@/server/lib/plugins/loader.server';
import { importPluginModule } from '@/server/lib/plugins/module-import.server';
import { callRpcMethod } from '@/server/lib/plugins/rpc.server';
import { pluginTopicValue } from '@/server/lib/plugins/realtime.server';
import { findHttpRoute } from '@/server/lib/plugins/http.server';
import { getDataDir } from '@/server/lib/lifecycle/paths';

const PLUGIN_ID = 'session-info';
let marketplaceRoot = '';
let previousOverride: string | undefined;

beforeAll(async () => {
  marketplaceRoot = await mkdtemp(join(tmpdir(), 'omp-plugin-e2e-'));
  previousOverride = Bun.env.KABMO_MARKETPLACE_DIR;
  Bun.env.KABMO_MARKETPLACE_DIR = marketplaceRoot;
  await isolateDb();

  // Copy the bundled plugin into the working marketplace and build it there —
  // the same two steps an install performs.
  const pluginsRoot = join(marketplaceRoot, 'plugins');
  await mkdir(pluginsRoot, { recursive: true });
  const target = join(pluginsRoot, PLUGIN_ID);
  await cp(join(packageDir(), 'marketplace/plugins', PLUGIN_ID), target, { recursive: true });

  const pkg = (await Bun.file(join(target, 'package.json')).json()) as { kabmo: unknown };
  const manifest = toManifest(pkg.kabmo, target);
  if ('error' in manifest) throw new Error(manifest.error);
  const built = await buildPanelPlugin(target, manifest);
  if (built.status !== 'built') throw new Error(`fixture build failed: ${built.reason}`);
  invalidatePanelScan();
}, 240_000);

afterAll(async () => {
  await disposePlugin(PLUGIN_ID);
  await releaseDb();
  if (previousOverride === undefined) delete Bun.env.KABMO_MARKETPLACE_DIR;
  else Bun.env.KABMO_MARKETPLACE_DIR = previousOverride;
  await rm(marketplaceRoot, { recursive: true, force: true });
});

describe('a real plugin server half', () => {
  test('loads through the registry and registers everything it declared', async () => {
    const record = await loadPluginServer(PLUGIN_ID);
    expect(record.pluginId).toBe(PLUGIN_ID);
    expect(loadedPluginIds()).toContain(PLUGIN_ID);
    expect(pluginLoadErrors()).toEqual([]);
    // The example registers one HTTP route and seeds its topic at load.
    expect(findHttpRoute(PLUGIN_ID, '/notes')).toBeDefined();
    expect(pluginTopicValue(PLUGIN_ID)).toEqual({ noteCount: 0 });
  });

  test('an RPC call reaches the plugin and writes to its own storage', async () => {
    const context = { url: 'http://localhost/api/plugins/session-info/rpc/save', signal: new AbortController().signal };

    const saved = await callRpcMethod(PLUGIN_ID, 'save', { sessionId: 's-1', note: 'hello' }, context);
    expect(saved).toEqual({ ok: true, value: { saved: true } });

    // The write is visible through the plugin's OWN read method...
    const read = await callRpcMethod(PLUGIN_ID, 'get', 's-1', context);
    expect(read.ok).toBe(true);
    if (read.ok && read.value && typeof read.value === 'object' && 'note' in read.value) {
      expect(read.value.note).toBe('hello');
    } else {
      throw new Error(`the plugin's get answered ${JSON.stringify(read)}`);
    }

    // ...and the topic moved, because the handler publishes the count.
    expect(pluginTopicValue(PLUGIN_ID)).toEqual({ noteCount: 1 });
  });

  test('the input schema refuses a bad argument before the handler runs', async () => {
    const context = { url: 'http://x', signal: new AbortController().signal };
    const bad = await callRpcMethod(PLUGIN_ID, 'save', { sessionId: 's-1', note: 42 }, context);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('invalid_input');
      expect(bad.error.issues?.[0]?.message).toContain('note must be a string');
    }
  });

  test('the HTTP route answers a real Request', async () => {
    const route = findHttpRoute(PLUGIN_ID, '/notes');
    expect(route).toBeDefined();
    const response = await route!.handler(new Request('http://localhost/api/plugins/session-info/http/notes'));
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({ method: 'GET', count: 1, ids: ['s-1'] });
  });

  test('an undeclared path is absent rather than prefix-matched', () => {
    expect(findHttpRoute(PLUGIN_ID, '/notes/detail')).toBeUndefined();
    expect(findHttpRoute(PLUGIN_ID, '/')).toBeUndefined();
  });

  test('disposal takes every registration back', async () => {
    await disposePlugin(PLUGIN_ID);

    expect(loadedPluginIds()).not.toContain(PLUGIN_ID);
    expect(findHttpRoute(PLUGIN_ID, '/notes')).toBeUndefined();
    expect(pluginTopicValue(PLUGIN_ID)).toBeUndefined();
    const after = await callRpcMethod(PLUGIN_ID, 'save', { sessionId: 's-1', note: 'x' }, {
      url: 'http://x',
      signal: new AbortController().signal,
    });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe('unknown_method');
  });
});

describe('the host facts a plugin is handed', () => {
  test('paths.dataDir is the host resolution, not a plugin guess', async () => {
    // The bug this pins: a plugin that keeps files had to re-derive
    // `KABMO_DATA_DIR`/`~/.kabmo` itself, which is wrong on every relocated
    // install and a second copy of a fact `getDataDir()` owns.
    const record = await loadPluginServer(PLUGIN_ID);
    expect(record.api.paths.dataDir).toBe(getDataDir());
    // ABSOLUTE, asked portably: `startsWith('/')` is a POSIX assumption and this
    // gate runs on Windows too, where the answer is `D:\…` (measured on the
    // Windows leg, which failed the whole case on the drive letter alone).
    expect(isAbsolute(record.api.paths.dataDir)).toBe(true);
  });

  test('a relocated data dir is what a freshly loaded plugin sees', async () => {
    // A plugin is loaded ONCE and its API object is kept, so the relocation is
    // observable only after a dispose — which is exactly the reload path a
    // `bun --hot` save or a disable/enable takes.
    const previous = Bun.env.KABMO_DATA_DIR;
    Bun.env.KABMO_DATA_DIR = join(marketplaceRoot, 'relocated');
    try {
      await disposePlugin(PLUGIN_ID);
      const record = await loadPluginServer(PLUGIN_ID);
      expect(record.api.paths.dataDir).toBe(join(marketplaceRoot, 'relocated'));
    } finally {
      if (previous === undefined) delete Bun.env.KABMO_DATA_DIR;
      else Bun.env.KABMO_DATA_DIR = previous;
      await disposePlugin(PLUGIN_ID);
    }
  });
});

describe('a rebuilt bundle is not masked by the module cache', () => {
  test('importPluginModule reads the file again when it changed', async () => {
    // Measured: Bun keys an ESM module by its resolved URL, so a plain
    // `import(entry)` returned the FIRST copy after a Rebuild — the plugin kept
    // running its previous code until the process restarted, and the UI had no
    // way to say so.
    const dir = await mkdtemp(join(tmpdir(), 'plugin-bust-'));
    const file = join(dir, 'bundle.js');
    await Bun.write(file, 'export default function factory() { return 1; }\n');
    const first = await importPluginModule(file);
    const firstModule = first.module as { default: () => number };
    expect(firstModule.default()).toBe(1);

    await Bun.write(file, 'export default function factory() { return 2; }\n');
    const second = await importPluginModule(file);
    const secondModule = second.module as { default: () => number };
    expect(secondModule.default()).toBe(2);
    expect(secondModule).not.toBe(firstModule);

    // The copy outlives the import on purpose (a plugin may spawn itself from
    // `import.meta.url`) and goes away with the plugin.
    const copies = readdirSync(dir).filter((name) => name.includes('.load-'));
    expect(copies.length).toBe(2);
    await first.cleanup();
    expect(readdirSync(dir).filter((name) => name.includes('.load-')).length).toBe(1);
    await second.cleanup();
    await rm(dir, { recursive: true, force: true });
  });
});
