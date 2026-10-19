/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The runtime-shim build plugin.
 *
 * A plugin bundle must NOT carry its own Preact, its own UI kit or its own SDK.
 * Every one of those is stateful in a way that breaks across two copies — two
 * Preacts give two module-level hook states (`Cannot read properties of
 * undefined (reading '__H')` at the first render), and the UI kit reads the
 * services the HOST injected. So the build makes each specifier EXTERNAL and
 * rewrites it to read `globalThis.__kabmoPluginRuntime.<slot>`, which the
 * host publishes before any bundle loads.
 *
 * The named exports are INTROSPECTED from the real module at build time rather
 * than hand-listed, because a hand-written list drifts the moment the host adds
 * an export: the plugin would then fail with `does not provide an export named
 * …`, at load, in the browser, for a symbol the host actually has.
 */

import type { BunPlugin } from 'bun';

/** Specifier → runtime slot. Frozen by `PluginRuntimeSlots` in the SDK. */
export const RUNTIME_SLOT_BY_SPECIFIER: Readonly<Record<string, string>> = {
  preact: 'preact',
  'preact/hooks': 'hooks',
  'preact/jsx-runtime': 'jsxRuntime',
  'preact/jsx-dev-runtime': 'jsxDevRuntime',
  'preact/compat': 'compat',
  '@kabmo-labs/kabmo-sdk/app': 'sdkApp',
  '@kabmo-labs/kabmo-ui': 'ui',
  '@kabmo-labs/kabmo-ui/components': 'uiComponents',
  // The pre-rename package names. A bundle built against `@kabmo-labs/plugin-sdk`
  // or `@kabmo-labs/ui` is already on disk in every installed plugin, and the
  // host publishes the same slots under every name — so an old bundle keeps
  // loading instead of failing at `Cannot load … must be loaded by Kabmo`.
  '@kabmo-labs/plugin-sdk/app': 'sdkApp',
  '@kabmo-labs/ui': 'ui',
  '@kabmo-labs/ui/components': 'uiComponents',
  // The same, for the names from before the product rename.
  '@ompchamber/plugin-sdk/app': 'sdkApp',
  '@ompchamber/ui': 'ui',
  '@ompchamber/ui/components': 'uiComponents',
};

/**
 * Exports to forward for a specifier whose module cannot be imported here.
 *
 * Only reached when the build process cannot resolve a specifier it is shimming
 * — a broken install, not a plugin problem. `jsx-runtime` and `jsx-dev-runtime`
 * are listed because they are the ones a transpiled TSX file imports BY NAME,
 * so an empty list there would break every plugin rather than degrade.
 */
/**
 * Which module's exports a shimmed specifier should carry, when it is not the
 * specifier itself.
 *
 * The pre-rename package names are shimmed (an installed bundle imports them)
 * but are no longer installed, so importing the specifier to introspect answers
 * nothing — and an empty export list makes Bun fail the build with
 * `No matching export in "kabmo-plugin-runtime-shim:@kabmo-labs/plugin-sdk/app"
 * for import "definePluginApp"`. The slots are the same objects, so the export
 * NAMES come from the module that actually ships.
 */
const INTROSPECT_AS: Readonly<Record<string, string>> = {
  '@kabmo-labs/plugin-sdk/app': '@kabmo-labs/kabmo-sdk/app',
  '@kabmo-labs/ui': '@kabmo-labs/kabmo-ui',
  '@kabmo-labs/ui/components': '@kabmo-labs/kabmo-ui/components',
  '@ompchamber/plugin-sdk/app': '@kabmo-labs/kabmo-sdk/app',
  '@ompchamber/ui': '@kabmo-labs/kabmo-ui',
  '@ompchamber/ui/components': '@kabmo-labs/kabmo-ui/components',
};

const FALLBACK_EXPORTS: Readonly<Record<string, readonly string[]>> = {
  'preact/jsx-runtime': ['Fragment', 'jsx', 'jsxs'],
  'preact/jsx-dev-runtime': ['Fragment', 'jsxDEV'],
};

const NAMESPACE = 'kabmo-plugin-runtime-shim';

/** The module source that reads one slot off the host runtime. */
export function shimModuleSource(specifier: string, slot: string, names: readonly string[]): string {
  return [
    // The pre-rename global is still published by the host, because a bundle
    // built before the rename reads that name directly.
    'const runtime = globalThis.__kabmoPluginRuntime ?? globalThis.__ompchamberPluginRuntime;',
    `if (runtime == null || runtime.${slot} == null) {`,
    `  throw new Error(${JSON.stringify(
      `Cannot load "${specifier}": this bundle must be loaded by Kabmo app, which provides the shared plugin runtime.`,
    )});`,
    '}',
    `const mod = runtime.${slot};`,
    'export default ("default" in mod ? mod.default : mod);',
    'export const {',
    ...names.map((name) => `  ${name},`),
    '} = mod;',
    '',
  ].join('\n');
}

/** `Object.keys` of the real module, sorted, so the output is deterministic. */
async function introspectExports(specifier: string): Promise<readonly string[]> {
  const source = INTROSPECT_AS[specifier] ?? specifier;
  try {
    const module = (await import(source)) as Record<string, unknown>;
    return Object.keys(module).sort();
  } catch {
    return FALLBACK_EXPORTS[source] ?? [];
  }
}

/**
 * The build plugin.
 *
 * `onResolve` sends every shimmed specifier to a private namespace, and
 * `onLoad` answers with the generated reader. Nothing else about the build
 * changes: the plugin's own dependencies still bundle normally.
 */
export function runtimeShimPlugin(): BunPlugin {
  const filter = new RegExp(
    `^(${Object.keys(RUNTIME_SLOT_BY_SPECIFIER)
      .map((specifier) => specifier.replace(/[/@.-]/g, '\\$&'))
      .join('|')})$`,
  );

  return {
    name: 'kabmo-plugin-runtime-shims',
    setup(build) {
      build.onResolve({ filter }, (args) => ({ path: args.path, namespace: NAMESPACE }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, async (args) => {
        const slot = RUNTIME_SLOT_BY_SPECIFIER[args.path];
        const names = await introspectExports(args.path);
        return { contents: shimModuleSource(args.path, slot, names), loader: 'js' };
      });
    },
  };
}
