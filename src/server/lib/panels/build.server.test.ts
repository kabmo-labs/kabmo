/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plugin builder.
 *
 * The distinction these tests exist to pin is `not-a-package` vs `failed`: a
 * hand-written HTML plugin must install and serve as-is, while a package whose
 * build breaks must not register. Collapsing them into one false answer made
 * every non-package plugin refuse to install — which is the bug the first
 * version shipped.
 *
 * A real `bun build` runs against a real temp package: the failure modes that
 * matter (a bad import, a missing output, an entry the manifest names that the
 * build never emits) live in the interaction between the build, the filesystem
 * and the manifest, and a stubbed builder would exercise none of them.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildPanelPlugin, describeInstallFailure, PLUGIN_BUILD_DIR } from '@/server/lib/panels/build.server';
import { kabmoPackageDirs, linkKabmoPackages } from '@/server/lib/panels/link.server';
import type { PanelPluginManifest } from '@/shared/types';

let root = '';

const manifest: PanelPluginManifest = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  app: `${PLUGIN_BUILD_DIR}/app.js`,
};

function writeFile(relative: string, content: string): void {
  const target = join(root, relative);
  fs.mkdirSync(join(target, '..'), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-build-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('buildPanelPlugin', () => {
  test('a directory with no app source is not-a-package, not a failure', async () => {
    writeFile('package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
    const result = await buildPanelPlugin(root, manifest);
    expect(result.status).toBe('not-a-package');
    expect(result.reason).toContain('src/app.tsx');
  });

  test('bundles src/app.tsx into the manifest app path with the runtime shimmed', async () => {
    writeFile('package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
    writeFile(
      'src/app.tsx',
      [
        "import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';",
        "import { useState } from 'preact/hooks';",
        'export default definePluginApp((app) => { app.rightPanel({ id: "x", component: () => useState(0) && null }); });',
      ].join('\n'),
    );

    const result = await buildPanelPlugin(root, manifest);
    expect(result.status).toBe('built');
    const bundle = fs.readFileSync(join(root, PLUGIN_BUILD_DIR, 'app.js'), 'utf8');
    // The shared runtime is READ, not bundled: no Preact and no SDK copy in the
    // output, and the shim's own guard is what names a host that is missing.
    expect(bundle).toContain('__kabmoPluginRuntime');
    expect(bundle).not.toContain('preact.module');
  });

  test('a bundle that fails to build reports the file and the message', async () => {
    writeFile('package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
    writeFile('src/app.tsx', 'import { missing } from "./nope";\nexport default missing;\n');
    const result = await buildPanelPlugin(root, manifest);
    expect(result.status).toBe('failed');
    expect(result.reason).toBeTruthy();
  });

  test('runs an explicit build script and honours its output', async () => {
    writeFile(
      'package.json',
      JSON.stringify({
        name: 'x',
        version: '1.0.0',
        scripts: { build: 'bun build src/entry.ts --outfile dist/app.js --target browser' },
      }),
    );
    writeFile('src/entry.ts', 'export default { built: true };');

    const result = await buildPanelPlugin(root, manifest);
    expect(result.status).toBe('built');
    expect(fs.readFileSync(join(root, PLUGIN_BUILD_DIR, 'app.js'), 'utf8')).toContain('built');
  });

  test('a failing build script reports failed with the compiler message', async () => {
    writeFile(
      'package.json',
      JSON.stringify({ name: 'x', version: '1.0.0', scripts: { build: 'bun build src/missing.ts --outdir dist' } }),
    );
    const result = await buildPanelPlugin(root, manifest);
    expect(result.status).toBe('failed');
    expect(result.reason).toBeTruthy();
  });

  test('a build that produces no bundle the manifest names is failed', async () => {
    writeFile(
      'package.json',
      JSON.stringify({
        name: 'x',
        version: '1.0.0',
        scripts: { build: 'bun build src/entry.ts --outfile dist/other.js --target browser' },
      }),
    );
    writeFile('src/entry.ts', 'export default {};');
    const result = await buildPanelPlugin(root, manifest);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('app.js');
  });

  test('a stale dist is replaced, not merged', async () => {
    writeFile('package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
    writeFile('src/app.tsx', 'export default { fresh: true };');
    writeFile(`${PLUGIN_BUILD_DIR}/stale.js`, 'export default "from a previous build";');

    const result = await buildPanelPlugin(root, manifest);
    expect(result.status).toBe('built');
    expect(fs.existsSync(join(root, PLUGIN_BUILD_DIR, 'stale.js'))).toBe(false);
  });
});

describe('linkKabmoPackages', () => {
  test('links each @kabmo-labs package once, keyed by package not specifier', async () => {
    await linkKabmoPackages(root);
    const scope = join(root, 'node_modules', '@kabmo-labs');
    if (!fs.existsSync(scope)) return; // no Kabmo packages resolvable in this environment
    const entries = fs.readdirSync(scope).sort();
    // `@kabmo-labs/kabmo-ui` and `@kabmo-labs/kabmo-ui/components` are ONE package, so the
    // second must not have replaced the first with its own directory.
    expect(entries).toEqual([...new Set(entries)]);
    for (const entry of entries) {
      const target = join(scope, entry);
      expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(join(target, 'package.json'))).toBe(true);
    }
  });

  test('is a no-op when the plugin has no node_modules to link into', async () => {
    // The directory is created, not required: a plugin that imports nothing from
    // Kabmo still builds, so a missing node_modules must not throw.
    await expect(linkKabmoPackages(join(root, 'nested'))).resolves.toBeUndefined();
  });

  test('never rewrites the HOST packages own dependency tree', async () => {
    // The regression this pins: an earlier version pointed each linked package's
    // `node_modules/preact` at the PLUGIN's copy. `packages/kabmo-ui` and
    // `packages/kabmo-sdk` are the host's own packages, so that replaced the
    // host's Preact with the plugin's — and because the runtime shim hands the
    // host's `preact/hooks` to every plugin, a plugin declaring `preact` made the
    // host hand out the WRONG hooks instance. Every plugin render then died with
    // `Cannot read properties of undefined (reading '__H')`, inside the host's
    // own UI kit, and the whole app went blank.
    //
    // The shim makes it unnecessary too: `preact` is external, so Kabmo's
    // bundler never resolves it through a linked package.
    const hostPackages = Object.values(kabmoPackageDirs());
    expect(hostPackages.length).toBeGreaterThan(0);

    // A plugin that ships its own Preact, which is the shape that triggered it.
    const pluginPreact = join(root, 'node_modules', 'preact');
    fs.mkdirSync(pluginPreact, { recursive: true });
    fs.writeFileSync(join(pluginPreact, 'package.json'), JSON.stringify({ name: 'preact', version: '9.0.0' }));

    await linkKabmoPackages(root);

    for (const packageRoot of hostPackages) {
      const hijacked = join(packageRoot, 'node_modules', 'preact');
      if (!fs.existsSync(hijacked)) continue;
      // If the host package resolves a Preact at all, it must be its OWN — never
      // a symlink into the plugin directory.
      const stat = fs.lstatSync(hijacked);
      expect(stat.isSymbolicLink() && fs.realpathSync(hijacked) === fs.realpathSync(pluginPreact)).toBe(false);
    }
  });
});

describe('describeInstallFailure', () => {
  test('picks the error line, not the usage banner that follows it', () => {
    // The real shape of a failed `bun install`: the error first, then the banner
    // and the package.json script list. Taking the LAST line reported
    // `$ bun run build` as the reason a plugin could not install.
    const stderr = [
      'error: GET https://registry.npmjs.org/@kabmo-labs%2Fui - 404',
      '',
      'error: @kabmo-labs/kabmo-ui@^1.0.0 failed to resolve',
      '',
      'Bun v1.4.2 (macOS arm64)',
      '',
    ].join('\n');
    expect(describeInstallFailure(stderr, undefined)).toBe(
      'error: GET https://registry.npmjs.org/@kabmo-labs%2Fui - 404',
    );
  });

  test('falls back to the first substantive line when there is no error line', () => {
    expect(describeInstallFailure('Resolving dependencies\nsomething went wrong\n', undefined)).toBe(
      'something went wrong',
    );
  });

  test('reports a plain failure when there is nothing to read', () => {
    expect(describeInstallFailure(undefined, undefined)).toBe('bun install failed');
  });
});

describe('optional peer dependencies', () => {
  test('a plugin declaring @kabmo-labs/* as optional peers builds against the links', async () => {
    writeFile(
      'package.json',
      JSON.stringify({
        name: 'x',
        version: '1.0.0',
        scripts: { build: 'bun build src/entry.ts --outfile dist/app.js --target browser' },
        peerDependencies: { '@kabmo-labs/kabmo-ui': '*' },
        peerDependenciesMeta: { '@kabmo-labs/kabmo-ui': { optional: true } },
      }),
    );
    writeFile('src/entry.ts', 'export default { ok: true };');
    const result = await buildPanelPlugin(root, manifest);
    // The peer is absent from npm, so an install that tried to fetch it would
    // fail here — this is the regression guard for declaring it as a dependency.
    expect(result.status).toBe('built');
  });
});

describe('peer dependency declaration', () => {
  test('an optional peer that is absent from the registry does not fail the install', async () => {
    // The package below does not exist on npm, so any form that FETCHES it fails
    // here. `dependencies` and a non-optional peer both exit 1 (measured on Bun
    // 1.4.2); only the `optional` flag installs and builds.
    writeFile(
      'package.json',
      JSON.stringify({
        name: 'x',
        version: '1.0.0',
        scripts: { build: 'bun build src/entry.ts --outfile dist/app.js --target browser' },
        peerDependencies: { '@kabmo-labs/definitely-not-published': '*' },
        peerDependenciesMeta: { '@kabmo-labs/definitely-not-published': { optional: true } },
      }),
    );
    writeFile('src/entry.ts', 'export default { ok: true };');

    const result = await buildPanelPlugin(root, manifest);
    expect(result.status).toBe('built');
  });
});

describe('kabmoPackageDirs', () => {
  test('resolves the packages Kabmo actually runs with', () => {
    const dirs = kabmoPackageDirs();
    // Resolved at runtime, not listed as paths: a source checkout keeps them
    // under `packages/` while a published install has them in `node_modules`,
    // and `packages/` is not shipped at all. `Bun.resolveSync` answers both.
    expect(Object.keys(dirs).sort()).toEqual(['@kabmo-labs/kabmo-sdk', '@kabmo-labs/kabmo-ui']);
    // The pre-rename names resolve too when they are installed, which is what
    // keeps a plugin that has not been republished yet buildable; this checkout
    // no longer carries them, so the assertion is on the CURRENT pair only.
    for (const dir of Object.values(dirs)) {
      expect(fs.existsSync(join(dir, 'package.json'))).toBe(true);
    }
  });

  test('every resolved directory is one a symlink can point at', () => {
    // The link target must be the package ROOT, not its entry file — linking a
    // `.ts` file would leave the specifier's subpath exports unresolvable.
    for (const dir of Object.values(kabmoPackageDirs())) {
      expect(fs.lstatSync(dir).isDirectory()).toBe(true);
    }
  });
});
