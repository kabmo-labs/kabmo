/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The runtime shim — the piece that decides whether a plugin bundle carries its
 * own Preact.
 *
 * It is not a size optimisation. Two Preact instances mean two module-level hook
 * states, and a component created by one rendered in the other's tree dies at
 * the first render with `Cannot read properties of undefined (reading '__H')` —
 * the whole app goes blank. So the two things pinned here are the two that
 * matter:
 *
 * - every shared specifier resolves to the SHIM, not to the real module;
 * - the generated reader forwards the module's ACTUAL named exports, because a
 *   hand-written list drifts the moment the host adds one and the plugin then
 *   fails at load with `does not provide an export named …`.
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RUNTIME_SLOT_BY_SPECIFIER, runtimeShimPlugin, shimModuleSource } from '@/server/lib/panels/shim';

describe('RUNTIME_SLOT_BY_SPECIFIER', () => {
  test('covers every specifier the SDK contract publishes a slot for', () => {
    // These names are frozen by `PluginRuntimeSlots`; a rename on either side
    // has to be caught here rather than at load in a browser.
    expect(Object.keys(RUNTIME_SLOT_BY_SPECIFIER).sort()).toEqual(
      [
        '@kabmo-labs/kabmo-sdk/app',
        '@kabmo-labs/kabmo-ui',
        '@kabmo-labs/kabmo-ui/components',
        // The package names before the `kabmo-` prefix was added. A bundle on
        // disk imports these, so they have to resolve to the same slots.
        '@kabmo-labs/plugin-sdk/app',
        '@kabmo-labs/ui',
        '@kabmo-labs/ui/components',
        // And the names from before the product rename.
        '@ompchamber/plugin-sdk/app',
        '@ompchamber/ui',
        '@ompchamber/ui/components',
        'preact',
        'preact/compat',
        'preact/hooks',
        'preact/jsx-dev-runtime',
        'preact/jsx-runtime',
      ].sort(),
    );
  });
});

describe('legacy package specifiers', () => {
  // A plugin bundle on disk imports the pre-rename names, and those packages are
  // no longer installed — so introspecting the SPECIFIER answers nothing and Bun
  // fails the build with `No matching export in "kabmo-plugin-runtime-shim:…"
  // for import "definePluginApp"`. The export NAMES have to come from the
  // module that ships.
  test('a build from a legacy specifier carries the current exports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kabmo-shim-legacy-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'src/app.tsx'),
        [
          "import { definePluginApp } from '@kabmo-labs/plugin-sdk/app';",
          "import { Panel } from '@kabmo-labs/ui/components';",
          'export default definePluginApp((app) => { app.rightPanel({ id: "x", component: () => Panel }); });',
        ].join('\n'),
      );
      const result = await Bun.build({
        entrypoints: [join(root, 'src/app.tsx')],
        target: 'browser',
        format: 'esm',
        outdir: join(root, 'dist'),
        plugins: [runtimeShimPlugin()],
      });
      expect(result.logs.map((log) => log.message).join(' ')).not.toContain('No matching export');
      expect(result.success).toBe(true);
      const bundle = readFileSync(join(root, 'dist/app.js'), 'utf8');
      // Still the HOST's runtime, under the name the plugin wrote.
      expect(bundle).toContain('__kabmoPluginRuntime');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('shimModuleSource', () => {
  test('reads the slot and throws a message naming the bundle when it is absent', () => {
    const source = shimModuleSource('preact/hooks', 'hooks', ['useState']);

    expect(source).toContain('globalThis.__kabmoPluginRuntime');
    expect(source).toContain('runtime.hooks == null');
    expect(source).toContain('must be loaded by Kabmo app');
    // The specifier is named in the error, so the failing import is identifiable.
    expect(source).toContain('preact/hooks');
  });

  test('forwards the named exports and a default', () => {
    const source = shimModuleSource('preact', 'preact', ['Component', 'render']);

    expect(source).toContain('export default ("default" in mod ? mod.default : mod);');
    expect(source).toContain('Component,');
    expect(source).toContain('render,');
  });

  test('emits a valid named-export list for an empty module', () => {
    // An empty list still has to parse: `export const { } = mod;` is not valid
    // syntax on its own line shape, so the generated text must stay well formed.
    const source = shimModuleSource('@kabmo-labs/kabmo-ui/components', 'uiComponents', []);
    expect(source).toContain('export const {');
    expect(source.trimEnd().endsWith('} = mod;')).toBe(true);
  });
});

describe('runtimeShimPlugin', () => {
  test('resolves the shared specifiers through the shim, and leaves others alone', async () => {
    const plugin = runtimeShimPlugin();
    const resolveHooks: ((args: { path: string }) => unknown)[] = [];
    const loadHooks: ((args: { path: string; namespace: string }) => Promise<{ contents: string }>)[] = [];

    plugin.setup({
      onResolve: (_filter: unknown, handler: never) => resolveHooks.push(handler),
      onLoad: (_filter: unknown, handler: never) => loadHooks.push(handler),
    } as never);

    const resolve = resolveHooks[0];
    const load = loadHooks[0];

    // A shared specifier is routed into the shim's own namespace...
    const shared = resolve({ path: 'preact/hooks' }) as { namespace?: string; path: string } | undefined;
    expect(shared?.namespace).toBeTruthy();
    expect(shared?.path).toBe('preact/hooks');

    // ...and the loaded source is the reader, not the module.
    const loaded = await load({ path: 'preact/hooks', namespace: shared?.namespace as string });
    expect(loaded.contents).toContain('__kabmoPluginRuntime');
  });

  test('introspects the real exports, so the runtime list cannot drift', async () => {
    const plugin = runtimeShimPlugin();
    const loadHooks: ((args: { path: string; namespace: string }) => Promise<{ contents: string }>)[] = [];
    plugin.setup({
      onResolve: () => {},
      onLoad: (_filter: unknown, handler: never) => loadHooks.push(handler),
    } as never);

    const loaded = await loadHooks[0]({ path: 'preact/jsx-runtime', namespace: 'kabmo-plugin-runtime-shim' });

    // These three are what a transpiled TSX file imports BY NAME; a shim that
    // omitted them would break every plugin rather than degrade.
    expect(loaded.contents).toContain('jsx,');
    expect(loaded.contents).toContain('jsxs,');
    expect(loaded.contents).toContain('Fragment,');
  });
});
