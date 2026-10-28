/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Seeding and installing, exercised against a real temp marketplace.
 *
 * The install path is tested end to end against a LOCAL git repository rather
 * than a mock: the failure modes that matter — a repository that is not a
 * plugin, a clone that leaves a partial directory, a catalog that cannot be
 * written — all live in the interaction between `git`, the filesystem and the
 * scan, and a stubbed `git` would exercise none of them.
 *
 * `Bun.which('git')` guards the suite: without git the install tests are
 * skipped rather than failing, because Kabmo treats a missing git as an
 * environment condition, not a bug.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverPanelPlugins, getMarketplaceCatalogPath, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { installPanelPluginFromGit } from '@/server/lib/panels/install.server';
import { seedDefaultMarketplace } from '@/server/lib/panels/seed.server';

let root = '';
let work = '';

const VALID = {
  id: 'from-git',
  name: 'From Git',
  version: '2.0.0',
  description: 'Installed from a repository.',
  app: 'dist/app.js',
};

/** Create a git repository holding a plugin, and return its path as a URL. */
function makePluginRepo(manifest: unknown, extra: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(join(work, 'repo-'));
  fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify(manifest));
  // The bundle is committed with the plugin here: the install only builds when
  // the plugin is a package, and this fixture is a plain directory.
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
  for (const [name, content] of Object.entries(extra)) {
    const target = join(dir, name);
    fs.mkdirSync(join(target, '..'), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const run = (args: string[]) => Bun.spawnSync(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe' });
  run(['init', '-q']);
  // Pin the line ending: a Windows host defaults `core.autocrlf` to true, which
  // rewrites every checked-out file to CRLF.
  run(['config', 'core.autocrlf', 'false']);
  run(['config', 'core.eol', 'lf']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'init']);
  return dir;
}

const hasGit = Boolean(Bun.which('git'));

/** Run `fn` with the bundled marketplace pointed at `dir`, restoring it after. */
async function withBundledStore<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.KABMO_BUNDLED_MARKETPLACE_DIR;
  process.env.KABMO_BUNDLED_MARKETPLACE_DIR = dir;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.KABMO_BUNDLED_MARKETPLACE_DIR;
    else process.env.KABMO_BUNDLED_MARKETPLACE_DIR = previous;
  }
}

/** A bundled store holding one plugin directory. */
function makeBundledStore(manifest: unknown = VALID): string {
  const bundled = fs.mkdtempSync(join(work, 'bundled-'));
  fs.mkdirSync(join(bundled, 'plugins', 'demo'), { recursive: true });
  fs.writeFileSync(join(bundled, 'plugins', 'demo', 'kabmo.json'), JSON.stringify(manifest));
  return bundled;
}

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-seed-'));
  work = fs.mkdtempSync(join(tmpdir(), 'kabmo-repos-'));
  process.env.KABMO_MARKETPLACE_DIR = root;
  invalidatePanelScan();
});

afterEach(() => {
  delete process.env.KABMO_MARKETPLACE_DIR;
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

describe('seedDefaultMarketplace', () => {
  test('creates an empty working marketplace and copies NO bundled plugin', async () => {
    const bundled = makeBundledStore();
    fs.writeFileSync(join(bundled, 'marketplace.json'), JSON.stringify({ name: 'Bundled' }));

    await withBundledStore(bundled, async () => {
      expect((await seedDefaultMarketplace()).seeded).toBe(true);
      // The catalog exists so the scan has a store to read...
      expect(fs.existsSync(join(root, 'marketplace.json'))).toBe(true);
      // ...but the bundled plugin is NOT copied: the bundled marketplace is a
      // store the user installs FROM, so a fresh Kabmo starts with nothing
      // installed and an empty activity bar.
      expect(fs.existsSync(join(root, 'plugins', 'demo'))).toBe(false);

      invalidatePanelScan();
      const payload = await discoverPanelPlugins();
      expect(payload.panels).toEqual([]);
      expect(payload.catalog.map((entry) => entry.pluginId)).toEqual(['from-git']);
      expect(payload.catalog[0].installed).toBe(false);
    });
  });

  test('a second run leaves an existing marketplace alone', async () => {
    await withBundledStore(makeBundledStore(), async () => {
      expect((await seedDefaultMarketplace()).seeded).toBe(true);
      // A plugin the user installed afterwards is never disturbed by a later
      // boot, and the catalog the user's install appended to is not rewritten.
      fs.mkdirSync(join(root, 'plugins', 'mine'), { recursive: true });
      fs.writeFileSync(join(root, 'plugins', 'mine', 'kabmo.json'), JSON.stringify({ ...VALID, id: 'mine' }));
      expect((await seedDefaultMarketplace()).seeded).toBe(false);
      expect(fs.existsSync(join(root, 'plugins', 'mine', 'kabmo.json'))).toBe(true);
    });
  });

  test('a missing bundled marketplace reports why, without throwing', async () => {
    await withBundledStore(join(work, 'nope'), async () => {
      expect((await seedDefaultMarketplace()).reason).toContain('no bundled marketplace');
      // The working directory is still usable: a package that ships no store
      // simply offers nothing, which is not a failure to start.
      expect(fs.existsSync(join(root, 'marketplace.json'))).toBe(true);
    });
  });
});

describe('installPanelPluginFromGit', () => {
  test('refuses a bare name before spawning anything', async () => {
    const result = await installPanelPluginFromGit('some-plugin');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('https');
  });

  test.skipIf(!hasGit)('installs a plugin, registering it in the catalog', async () => {
    const repo = makePluginRepo(VALID);
    const result = await installPanelPluginFromGit(repo);
    expect(result.ok).toBe(true);
    expect(result.pluginId).toBe('from-git');
    expect(fs.existsSync(join(root, 'plugins', 'from-git', 'kabmo.json'))).toBe(true);

    const catalog = JSON.parse(fs.readFileSync(getMarketplaceCatalogPath(), 'utf8')) as {
      plugins: Array<{ name: string; source: string }>;
    };
    expect(catalog.plugins.map((p) => p.name)).toContain('from-git');
    expect(catalog.plugins.find((p) => p.name === 'from-git')?.source).toBe('plugins/from-git');

    invalidatePanelScan();
    const { panels, errors } = await discoverPanelPlugins();
    expect(errors).toEqual([]);
    expect(panels.map((p) => p.pluginId)).toEqual(['from-git']);
  });

  test.skipIf(!hasGit)('preserves the catalog it already had', async () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      getMarketplaceCatalogPath(),
      JSON.stringify({ name: 'Kabmo', description: 'keep me', plugins: [{ name: 'old', source: 'plugins/old' }] }),
    );
    const result = await installPanelPluginFromGit(makePluginRepo(VALID));
    expect(result.ok).toBe(true);

    const catalog = JSON.parse(fs.readFileSync(getMarketplaceCatalogPath(), 'utf8')) as {
      name: string;
      description: string;
      plugins: Array<{ name: string }>;
    };
    expect(catalog.name).toBe('Kabmo');
    expect(catalog.description).toBe('keep me');
    expect(catalog.plugins.map((p) => p.name)).toEqual(['old', 'from-git']);
  });

  test.skipIf(!hasGit)('refuses a repository with no manifest, leaving nothing behind', async () => {
    const dir = fs.mkdtempSync(join(work, 'plain-'));
    fs.writeFileSync(join(dir, 'README.md'), 'not a plugin');
    const run = (args: string[]) => Bun.spawnSync(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe' });
    run(['init', '-q']);
    // Pin the line ending: a Windows host defaults `core.autocrlf` to true.
    run(['config', 'core.autocrlf', 'false']);
    run(['config', 'core.eol', 'lf']);
    run(['config', 'user.email', 't@e.com']);
    run(['config', 'user.name', 'T']);
    run(['add', '-A']);
    run(['commit', '-q', '-m', 'init']);

    const result = await installPanelPluginFromGit(dir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('kabmo.json');
    // Nothing in the marketplace, and no staging directory left in it either.
    const entries = fs.existsSync(join(root, 'plugins')) ? fs.readdirSync(join(root, 'plugins')) : [];
    expect(entries).toEqual([]);
    expect(fs.readdirSync(root).filter((n) => n.startsWith('.installing-'))).toEqual([]);
  });

  test.skipIf(!hasGit)('refuses a manifest that does not validate', async () => {
    const repo = makePluginRepo({ ...VALID, app: '../outside.js' });
    const result = await installPanelPluginFromGit(repo);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('escapes the plugin directory');
  });

  test.skipIf(!hasGit)('builds a Bun-package plugin before registering it', async () => {
    const repo = makePluginRepo(
      VALID,
      {
        'package.json': JSON.stringify({
          name: 'from-git',
          version: '2.0.0',
          scripts: { build: 'bun build src/entry.ts --outfile dist/app.js --target browser' },
          kabmo: VALID,
        }),
        'src/entry.ts': 'export default { built: true };',
      },
    );
    // Remove the plain manifest so the package's own `kabmo` key is used.
    fs.rmSync(join(repo, 'kabmo.json'));

    const result = await installPanelPluginFromGit(repo);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(join(root, 'plugins', 'from-git', 'dist', 'app.js'))).toBe(true);

    invalidatePanelScan();
    const { panels, plugins, errors } = await discoverPanelPlugins();
    expect(errors).toEqual([]);
    expect(panels.map((p) => p.pluginId)).toEqual(['from-git']);
    expect(plugins[0].built).toBe(true);
    expect(plugins[0].isPackage).toBe(true);
  });

  test.skipIf(!hasGit)('a package whose build fails stays installed but unregistered', async () => {
    const repo = makePluginRepo(
      VALID,
      {
        'package.json': JSON.stringify({
          name: 'from-git',
          version: '2.0.0',
          scripts: { build: 'bun build src/missing.ts --outfile dist/app.js' },
          kabmo: VALID,
        }),
      },
    );
    fs.rmSync(join(repo, 'kabmo.json'));

    const result = await installPanelPluginFromGit(repo);
    expect(result.ok).toBe(true);
    expect(result.error).toBeTruthy();
    // The directory is there so a Rebuild can fix it; the catalog was NOT
    // written, so the pane reports an unbuilt plugin rather than a dangling
    // catalog entry.
    expect(fs.existsSync(join(root, 'plugins', 'from-git'))).toBe(true);
    expect(fs.existsSync(getMarketplaceCatalogPath())).toBe(false);

    invalidatePanelScan();
    const { plugins } = await discoverPanelPlugins();
    expect(plugins[0].built).toBe(false);
    expect(plugins[0].reason).toContain('dist/app.js');
  });

  test.skipIf(!hasGit)('refuses an id that is already installed', async () => {
    const repo = makePluginRepo(VALID);
    expect((await installPanelPluginFromGit(repo)).ok).toBe(true);
    const again = await installPanelPluginFromGit(repo);
    expect(again.ok).toBe(false);
    expect(again.error).toContain('already installed');
  });
});
