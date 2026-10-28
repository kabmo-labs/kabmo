/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The merge behind the Plugins pane: one list out of omp's two registries.
 *
 * The risky rules pinned here:
 *
 * - A marketplace plugin's runtime state is keyed by its PACKAGE NAME in the
 *   lockfile, never by its `name@marketplace` id — reading the id reports "no
 *   features" for every marketplace install. `readPluginPackageName` resolves
 *   that key from the install directory.
 * - Enablement is the AND of the CLI's flag and the lockfile's: either source
 *   saying `false` wins. A `null` `enabledFeatures` means "omp's defaults",
 *   which is distinct from an empty list.
 * - A SECRET setting is reported as present (`secretSet`) and its stored value
 *   must never reach the browser — the lockfile holds it in plaintext.
 * - A project-scoped install cannot have its features edited (omp writes the
 *   user lockfile), so it must carry `featuresEditable: false`.
 * - `omp` itself and entries without a name are not plugins.
 *
 * The `omp` CLI is replaced by a stub binary (via `KABMO_OMP_BIN`) that
 * prints a fixture — no real omp process, no network.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { executableStub } from '@/test-support/executable-stub';
import { testPosix } from '@/test-support/platform';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { listPlugins } from '@/server/lib/omp/config/plugins';

let root = '';
let xdg = '';
let cwd = '';
let userMktDir = '';
let projectMktDir = '';
let prevXdg: string | undefined;
let prevAgentDir: string | undefined;
let prevBin: string | undefined;

/** Write a fixture file, creating its parent directory. */
function writeJson(file: string, value: unknown): string {
  fs.mkdirSync(dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function manifestPackage(dir: string, pkg: Record<string, unknown>): string {
  writeJson(join(dir, 'package.json'), pkg);
  return dir;
}

beforeAll(async () => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-plugins-'));
  xdg = join(root, 'xdg');
  cwd = join(root, 'workspace');
  fs.mkdirSync(join(xdg, 'omp'), { recursive: true });
  fs.mkdirSync(join(cwd, '.omp', 'plugins'), { recursive: true });
  prevXdg = Bun.env.XDG_DATA_HOME;
  prevAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  prevBin = Bun.env.KABMO_OMP_BIN;
  Bun.env.XDG_DATA_HOME = xdg;
  delete Bun.env.PI_CODING_AGENT_DIR;

  userMktDir = manifestPackage(join(root, 'user-mkt'), {
    name: 'user-plugin-pkg',
    omp: { features: {}, settings: {} },
  });
  projectMktDir = manifestPackage(join(root, 'project-mkt'), {
    name: '@local/manifest-plugin',
    omp: {
      features: { fast: { default: true } },
      settings: { apiKey: { type: 'string', secret: true } },
    },
  });

  const catalog = writeJson(join(root, 'catalog.json'), {
    plugins: [
      { name: 'mkt-plugin', description: 'cat desc', version: '2.0.0', homepage: 'https://h' },
      { name: 'user-plugin', version: '1.0.0' },
    ],
  });
  writeJson(join(xdg, 'omp', 'marketplaces.json'), {
    marketplaces: [{ name: 'local-mkt', catalogPath: catalog }],
  });

  writeJson(join(xdg, 'omp', 'plugins', 'omp-plugins.lock.json'), {
    plugins: {
      alpha: { enabled: false, enabledFeatures: ['lockfeat'] },
      '@local/manifest-plugin': { enabled: false, enabledFeatures: ['user-feat'] },
    },
    settings: {
      alpha: { apiKey: 'SECRET-VALUE', region: 'eu', unset: 'ignored' },
      '@local/manifest-plugin': { apiKey: 'SECRET-VALUE-2' },
    },
  });
  writeJson(join(cwd, '.omp', 'plugins', 'omp-plugins.lock.json'), {
    plugins: { '@local/manifest-plugin': { enabled: true, enabledFeatures: ['p1'] } },
    settings: {},
  });

  const listFixture = writeJson(join(root, 'bin', 'omp-list.json'), {
    npm: [
      { name: 'omp', version: '9.9.9' },
      {
        name: 'alpha',
        version: '1.0.0',
        path: manifestPackage(join(root, 'alpha'), {
          name: 'alpha',
          omp: {
            description: 'from-manifest',
            features: { fast: { default: true } },
            settings: {
              apiKey: { type: 'string', secret: true },
              region: { type: 'enum', values: ['us', 'eu'] },
            },
          },
        }),
        enabled: true,
        enabledFeatures: ['cli-ignored'],
      },
      {
        name: 'beta',
        version: '2.0.0',
        enabled: true,
        enabledFeatures: ['x', 5, 'y'],
        manifest: { description: 'cli desc' },
      },
    ],
    marketplace: [
      {
        id: 'mkt-plugin@local-mkt',
        scope: 'project',
        shadowedBy: 'project',
        entries: [{ installPath: projectMktDir, version: '1.0.0', enabled: true }],
      },
      {
        id: 'user-plugin@local-mkt',
        scope: 'user',
        entries: [{ installPath: userMktDir, version: '1.0.0', enabled: false }],
      },
      { id: 'no-entries@local-mkt', entries: [] },
      { id: 'plainid' },
      { id: '' },
    ],
  });

  const stubSource = `import { readFileSync } from 'node:fs';
process.stdout.write(readFileSync(${JSON.stringify(listFixture)}));
`;
  Bun.env.KABMO_OMP_BIN = await executableStub(stubSource, 'fake-omp-plugin-list');
  invalidateOmpCliCache();
  // `resolveOmpBin` memoizes the FIRST binary it resolves for the process, so a
  // sibling suite's value would otherwise answer every call here.
  invalidateOmpCliCache();
});

afterAll(() => {
  if (prevXdg === undefined) delete Bun.env.XDG_DATA_HOME;
  else Bun.env.XDG_DATA_HOME = prevXdg;
  if (prevAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = prevAgentDir;
  if (prevBin === undefined) delete Bun.env.KABMO_OMP_BIN;
  else Bun.env.KABMO_OMP_BIN = prevBin;
  invalidateOmpCliCache();
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  globalThis.__ompPluginCatalogCache = undefined;
});

/**
 * Three cases below are POSIX-only, and not because of the stub binary: they
 * assert what the USER lockfile says, and omp resolves the user plugin root
 * through `$XDG_DATA_HOME` only on linux/darwin. On Windows `pluginDataRoot()`
 * falls back to the real `~/.omp` — omp's own rule, mirrored here — so a fixture
 * written under `$XDG_DATA_HOME` is never read, the lockfile looks absent, and
 * the CLI's flag answers instead. Pointing the fixture at `~/.omp` would write
 * to the developer's real plugin state, which no test may do. The cases that do
 * not depend on the user lock keep running on both platforms.
 */
describe('listPlugins', () => {
  test('skips omp itself and nameless entries, keeping npm order then marketplace order', async () => {
    const items = await listPlugins(cwd);
    expect(items.map((item) => item.id)).toEqual([
      'alpha',
      'beta',
      'mkt-plugin@local-mkt',
      'user-plugin@local-mkt',
      'no-entries@local-mkt',
      'plainid',
    ]);
  });

  testPosix('a package plugin takes its lockfile state, and the lockfile wins over the CLI', async () => {
    const alpha = (await listPlugins(cwd)).find((item) => item.id === 'alpha');
    expect(alpha).toMatchObject({
      name: 'alpha',
      packageName: 'alpha',
      version: '1.0.0',
      kind: 'package',
      scope: 'user',
      enabled: false,
      enabledFeatures: ['lockfeat'],
      description: 'from-manifest',
      features: [{ name: 'fast', isDefault: true }],
    });
  });

  test('a package plugin with no lockfile state falls back to the CLI flags', async () => {
    const beta = (await listPlugins(cwd)).find((item) => item.id === 'beta');
    expect(beta).toMatchObject({
      kind: 'package',
      enabled: true,
      enabledFeatures: ['x', 'y'],
      description: 'cli desc',
      features: [],
      settings: [],
    });
    expect(beta).not.toHaveProperty('installPath');
    expect(beta).not.toHaveProperty('settingValues');
    expect(beta).not.toHaveProperty('secretSet');
  });

  testPosix('a secret setting is reported set, and its plaintext value never leaves the server', async () => {
    const alpha = (await listPlugins(cwd)).find((item) => item.id === 'alpha');
    expect(alpha?.secretSet).toEqual(['apiKey']);
    expect(alpha?.settingValues).toEqual({ region: 'eu' });
    expect(JSON.stringify(alpha)).not.toContain('SECRET-VALUE');
  });

  testPosix('a project marketplace plugin is keyed by package name and cannot edit features', async () => {
    const item = (await listPlugins(cwd)).find((id) => id.id === 'mkt-plugin@local-mkt');
    expect(item).toMatchObject({
      name: 'mkt-plugin',
      packageName: '@local/manifest-plugin',
      marketplace: 'local-mkt',
      kind: 'marketplace',
      scope: 'project',
      enabled: true,
      enabledFeatures: ['p1'],
      shadowedBy: 'project',
      description: 'cat desc',
      homepage: 'https://h',
      updateAvailable: '2.0.0',
      featuresEditable: false,
      secretSet: ['apiKey'],
    });
    expect(typeof item?.featuresNote).toBe('string');
    expect(JSON.stringify(item)).not.toContain('SECRET-VALUE-2');
  });

  test('a user marketplace plugin reads the CLI enabled flag and has no feature lock', async () => {
    const item = (await listPlugins(cwd)).find((id) => id.id === 'user-plugin@local-mkt');
    expect(item).toMatchObject({
      packageName: 'user-plugin-pkg',
      scope: 'user',
      enabled: false,
      enabledFeatures: null,
      description: '',
      features: [],
      settings: [],
    });
    expect(item).not.toHaveProperty('featuresEditable');
    expect(item).not.toHaveProperty('shadowedBy');
    expect(item).not.toHaveProperty('updateAvailable');
  });

  test('a marketplace entry with no install entries and no @ keeps the id as its name', async () => {
    const items = await listPlugins(cwd);
    expect(items.find((item) => item.id === 'no-entries@local-mkt')).toMatchObject({
      name: 'no-entries',
      packageName: 'no-entries',
      marketplace: 'local-mkt',
      enabled: true,
      version: '',
    });
    const plain = items.find((item) => item.id === 'plainid');
    expect(plain).toMatchObject({ name: 'plainid', packageName: 'plainid', enabled: true });
    expect(plain).not.toHaveProperty('marketplace');
  });
});
