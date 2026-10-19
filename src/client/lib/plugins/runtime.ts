/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plugin runtime: the modules every plugin bundle borrows from the host.
 *
 * A plugin bundle is built with `preact`, `preact/hooks`, `preact/jsx-runtime`,
 * `preact/compat`, `@kabmo-labs/kabmo-sdk/app`, `@kabmo-labs/kabmo-ui` and
 * `@kabmo-labs/kabmo-ui/components` marked EXTERNAL; the build rewrites each of those
 * specifiers to read `globalThis.__kabmoPluginRuntime.<slot>`. That is the
 * whole reason the host publishes this object:
 *
 * - **One Preact.** A plugin that bundled its own copy would create components
 *   the host's tree cannot render: hooks resolve through a module-level state
 *   object, so two copies produce `Cannot read properties of undefined (reading
 *   '__H')` at the first render. It is not a size optimisation.
 * - **One UI kit, one SDK.** `@kabmo-labs/kabmo-ui` reads the host's injected
 *   services, so a plugin must get the host's instance, not its own.
 *
 * The slot names are frozen by `@kabmo-labs/kabmo-sdk/app`'s
 * `PluginRuntimeSlots`; a change here is a change to the published contract and
 * needs the build's shim list updated in the same commit.
 */

import * as preact from 'preact';
import * as hooks from 'preact/hooks';
import * as jsxRuntime from 'preact/jsx-runtime';
import * as jsxDevRuntime from 'preact/jsx-dev-runtime';
import * as compat from 'preact/compat';
import * as sdkApp from '@kabmo-labs/kabmo-sdk/app';
import * as ui from '@kabmo-labs/kabmo-ui';
import * as uiComponents from '@kabmo-labs/kabmo-ui/components';

/** The slot names, in one list so the build and the host cannot drift. */
export const PLUGIN_RUNTIME_SLOTS = {
  preact,
  hooks,
  jsxRuntime,
  jsxDevRuntime,
  compat,
  sdkApp,
  ui,
  uiComponents,
} as const;

/**
 * Publish the runtime.
 *
 * Idempotent, and it deliberately does NOT overwrite an existing object: under
 * `bun --hot` this module re-evaluates while loaded plugin bundles still hold
 * references into the old one, and replacing it would leave those plugins
 * reading a different Preact than the tree they are rendered in.
 */
export function installPluginRuntime(): void {
  const host = globalThis as { __kabmoPluginRuntime?: unknown; __ompchamberPluginRuntime?: unknown };
  host.__kabmoPluginRuntime ??= PLUGIN_RUNTIME_SLOTS;
  // A bundle built before the rename reads the old name directly, so the same
  // object is published under both. Two names, one instance — a second copy of
  // the slots would give plugins a different Preact, which is the failure the
  // whole mechanism exists to prevent.
  host.__ompchamberPluginRuntime ??= PLUGIN_RUNTIME_SLOTS;
}
