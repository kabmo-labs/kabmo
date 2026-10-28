/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The read-only plugin registries behind the Plugins settings pane.
 *
 * Every reader here has a failure mode the UI depends on:
 *
 * - `readLockFile` must answer "empty" for a missing or corrupt lockfile —
 *   a plugin root without one is a normal state, not an error.
 * - `readPluginManifest` normalizes an untrusted `package.json.omp`/`.pi`
 *   block: a feature or setting with the wrong shape must be dropped or
 *   defaulted, never rendered as a broken row.
 * - `readMarketplaces` reports `pluginCount: null` plus an `error` when a
 *   cached catalog is unreadable — the pane turns exactly that into an
 *   "update this marketplace" affordance.
 * - `readCatalogPlugins` marks `installed` by the `name@marketplace` key and
 *   caches a catalog by path+size, so a same-size rewrite is served stale.
 *
 * `XDG_DATA_HOME` is redirected to a temp dir so the real `~/.omp` plugin
 * state is never read or written.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { testPosix } from '@/test-support/platform';

import {
  projectPluginsDir,
  readCatalogPlugins,
  readLockFile,
  readMarketplaces,
  readPluginManifest,
  readPluginPackageName,
  userPluginsDir,
} from '@/server/lib/omp/config/plugin-registry';

let root = '';
let xdg = '';
let prevXdg: string | undefined;
let prevAgentDir: string | undefined;

beforeAll(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-plugin-registry-'));
  xdg = join(root, 'xdg');
  fs.mkdirSync(join(xdg, 'omp'), { recursive: true });
  prevXdg = Bun.env.XDG_DATA_HOME;
  prevAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  Bun.env.XDG_DATA_HOME = xdg;
  delete Bun.env.PI_CODING_AGENT_DIR;
});

afterAll(() => {
  if (prevXdg === undefined) delete Bun.env.XDG_DATA_HOME;
  else Bun.env.XDG_DATA_HOME = prevXdg;
  if (prevAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = prevAgentDir;
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  globalThis.__ompPluginCatalogCache = undefined;
});

/** A fresh directory under the temp root; named per test so cases never share files. */
function tempDir(name: string): string {
  const dir = join(root, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a fixture file, creating its parent directory. */
function writeJson(file: string, value: unknown): string {
  fs.mkdirSync(dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

describe('readLockFile', () => {
  test('a missing lockfile is the empty state, not an error', async () => {
    expect(await readLockFile(tempDir('empty-root'))).toEqual({ plugins: {}, settings: {} });
  });

  test('corrupt JSON and non-object members degrade to empty maps', async () => {
    const corrupt = tempDir('corrupt-root');
    writeJson(join(corrupt, 'omp-plugins.lock.json'), '{ not json');
    expect(await readLockFile(corrupt)).toEqual({ plugins: {}, settings: {} });

    const shaped = tempDir('shaped-root');
    writeJson(join(shaped, 'omp-plugins.lock.json'), { plugins: 'nope', settings: 42 });
    expect(await readLockFile(shaped)).toEqual({ plugins: {}, settings: {} });
  });

  test('a valid lockfile passes its plugin state and settings through', async () => {
    const dir = tempDir('valid-root');
    writeJson(join(dir, 'omp-plugins.lock.json'), {
      plugins: { alpha: { enabled: false, enabledFeatures: ['fast'] } },
      settings: { alpha: { apiKey: 'secret' } },
    });
    expect(await readLockFile(dir)).toEqual({
      plugins: { alpha: { enabled: false, enabledFeatures: ['fast'] } },
      settings: { alpha: { apiKey: 'secret' } },
    });
  });
});

describe('readPluginPackageName', () => {
  test('uses the package.json name, falling back when it is absent or blank', async () => {
    const dir = tempDir('pkg-name');
    writeJson(join(dir, 'package.json'), { name: '@local/real-plugin' });
    expect(await readPluginPackageName(dir, 'fallback')).toBe('@local/real-plugin');

    writeJson(join(dir, 'package.json'), { name: '' });
    expect(await readPluginPackageName(dir, 'fallback')).toBe('fallback');

    writeJson(join(dir, 'package.json'), { name: 42 });
    expect(await readPluginPackageName(dir, 'fallback')).toBe('fallback');

    expect(await readPluginPackageName(join(dir, 'missing'), 'fallback')).toBe('fallback');
    expect(await readPluginPackageName(undefined, 'fallback')).toBe('fallback');
  });
});

describe('readPluginManifest', () => {
  test('absent install path, package.json, or manifest is an empty manifest', async () => {
    const empty = { description: '', features: [], settings: [] };
    expect(await readPluginManifest(undefined)).toEqual(empty);

    const bare = tempDir('manifest-bare');
    expect(await readPluginManifest(bare)).toEqual(empty);

    writeJson(join(bare, 'package.json'), { name: 'x' });
    expect(await readPluginManifest(bare)).toEqual(empty);

    writeJson(join(bare, 'package.json'), { omp: 'not-an-object' });
    expect(await readPluginManifest(bare)).toEqual(empty);
  });

  test('normalizes features: description, default-only-true, and malformed specs', async () => {
    const dir = tempDir('manifest-features');
    writeJson(join(dir, 'package.json'), {
      omp: {
        description: 'OMP desc',
        features: {
          fast: { description: 'faster', default: true },
          slow: { default: false },
          bare: 'not-an-object',
        },
      },
    });
    expect(await readPluginManifest(dir)).toEqual({
      description: 'OMP desc',
      features: [{ name: 'fast', description: 'faster', isDefault: true }, { name: 'slow' }, { name: 'bare' }],
      settings: [],
    });
  });

  test('normalizes settings: invalid types dropped, secret/env/values/min/max/step kept', async () => {
    const dir = tempDir('manifest-settings');
    writeJson(join(dir, 'package.json'), {
      omp: {
        description: 42,
        settings: {
          apiKey: { type: 'string', secret: true, description: 'key', env: 'PKG_KEY' },
          region: { type: 'enum', values: ['us', 'eu', 7], default: 'us' },
          count: { type: 'number', min: 1, max: 10, step: 2, default: 0 },
          on: { type: 'boolean', default: false },
          bad: { type: 'object' },
          noType: { description: 'x' },
        },
      },
    });
    expect(await readPluginManifest(dir)).toEqual({
      description: '',
      features: [],
      settings: [
        { key: 'apiKey', type: 'string', description: 'key', secret: true, env: 'PKG_KEY' },
        { key: 'region', type: 'enum', values: ['us', 'eu'], default: 'us' },
        { key: 'count', type: 'number', default: 0, min: 1, max: 10, step: 2 },
        { key: 'on', type: 'boolean', default: false },
      ],
    });
  });

  test('falls back from the omp manifest to the legacy pi manifest', async () => {
    const dir = tempDir('manifest-pi');
    writeJson(join(dir, 'package.json'), { pi: { description: 'PI desc', features: { x: {} } } });
    expect(await readPluginManifest(dir)).toEqual({
      description: 'PI desc',
      features: [{ name: 'x' }],
      settings: [],
    });
  });
});

describe('readMarketplaces', () => {
  // The marketplace registry hides under the XDG data root, which the plugin
  // data-layout code honours only on linux/darwin; on Windows `userPluginsDir`/
  // `getMarketplacesRegistryPath` fall back to `~/.omp`, so a fixture written to
  // `$XDG_DATA_HOME` is never read there.
  testPosix('reports a catalog size, and null plus an error when it is unreadable', async () => {
    const catalog = writeJson(join(root, 'catalogs', 'one.json'), { plugins: [{ name: 'a' }, { name: 'b' }] });
    writeJson(join(xdg, 'omp', 'marketplaces.json'), {
      marketplaces: [
        { name: 'good', sourceType: 'github', sourceUri: 'u', addedAt: 'a', updatedAt: 'b', catalogPath: catalog },
        { name: 'bad', catalogPath: join(root, 'catalogs', 'missing.json') },
        { catalogPath: catalog },
      ],
    });
    expect(await readMarketplaces()).toEqual([
      { name: 'good', sourceType: 'github', sourceUri: 'u', addedAt: 'a', updatedAt: 'b', pluginCount: 2 },
      {
        name: 'bad',
        sourceType: 'git',
        sourceUri: '',
        addedAt: '',
        updatedAt: '',
        pluginCount: null,
        error: 'Cached catalog not readable — update this marketplace.',
      },
    ]);
  });
});

describe('readCatalogPlugins', () => {
  testPosix('shapes entries, drops nameless ones, and marks installed by name@marketplace', async () => {
    const catalog = writeJson(join(root, 'catalogs', 'two.json'), {
      plugins: [
        { name: 'alpha', description: 'A', category: 'cat', homepage: 'https://x', version: '1.2.3' },
        { name: '' },
        { description: 'no name' },
      ],
    });
    writeJson(join(xdg, 'omp', 'marketplaces.json'), {
      marketplaces: [{ name: 'mkt', catalogPath: catalog }, { name: 'no-catalog' }],
    });
    expect(await readCatalogPlugins(new Set(['alpha@mkt']))).toEqual([
      {
        name: 'alpha',
        marketplace: 'mkt',
        description: 'A',
        category: 'cat',
        homepage: 'https://x',
        version: '1.2.3',
        installed: true,
      },
    ]);
  });

  testPosix('serves a catalog rewrite of the same byte size from the path+size cache', async () => {
    const catalog = join(root, 'catalogs', 'cached.json');
    writeJson(catalog, { plugins: [{ name: 'one' }] });
    writeJson(join(xdg, 'omp', 'marketplaces.json'), { marketplaces: [{ name: 'mkt', catalogPath: catalog }] });

    expect((await readCatalogPlugins(new Set())).map((p) => p.name)).toEqual(['one']);
    // Same byte length, different content: the cache key is path+size+TTL.
    writeJson(catalog, { plugins: [{ name: 'two' }] });
    expect((await readCatalogPlugins(new Set())).map((p) => p.name)).toEqual(['one']);
  });
});

describe('plugin roots', () => {
  testPosix('userPluginsDir follows the XDG data root', () => {
    expect(userPluginsDir()).toBe(join(xdg, 'omp', 'plugins'));
  });

  test('projectPluginsDir anchors on the nearest .omp or .git, else the cwd', () => {
    const plain = tempDir('plain-project');
    expect(projectPluginsDir(plain)).toBe(join(plain, '.omp', 'plugins'));

    const anchored = tempDir('anchored-project');
    fs.mkdirSync(join(anchored, '.omp'), { recursive: true });
    const nested = join(anchored, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    expect(projectPluginsDir(nested)).toBe(join(anchored, '.omp', 'plugins'));

    const gitAnchored = tempDir('git-project');
    fs.mkdirSync(join(gitAnchored, '.git'), { recursive: true });
    expect(projectPluginsDir(join(gitAnchored, 'sub'))).toBe(join(gitAnchored, '.omp', 'plugins'));
  });
});
