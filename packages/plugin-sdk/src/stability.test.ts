/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The stability policy, pinned.
 *
 * Two things a plugin author needs to be able to rely on, and neither is
 * visible from reading one file:
 *
 * - **Which surfaces are STABLE.** A plugin that builds against `useRpc` should
 *   not discover in a changelog that it moved; a plugin that builds against
 *   `experimental_useSidebarThreads` should know it opted into movement.
 * - **That the marker means ONE thing.** `experimental_` is a contract, not
 *   decoration: it says the shape may change between minor versions. A surface
 *   that gains or loses the prefix is a change a plugin author has to act on, so
 *   the set is asserted rather than left to whoever edits the file next.
 *
 * The stable/experimental split is not arbitrary — it follows bb's own, measured
 * against `get-bb/bb` @ `main` (`PluginSdkApp`): bb ships `useRpc`, `useRealtime`
 * and `useComposer` unprefixed, and marks its sidebar-thread and provider-icon
 * surfaces `experimental_`.
 */

import { describe, expect, test } from 'bun:test';
import * as kit from '@kabmo-labs/ui';
import * as sdk from '@kabmo-labs/plugin-sdk';

/** The kit's exports that are participant SURFACES, by their stable name. */
const STABLE_HOOKS = ['useRpc', 'useRealtime', 'useComposer'] as const;

/** Surfaces that carry the marker, so their shape may move. */
const EXPERIMENTAL_HOOKS = [
  'experimental_useSidebarThreads',
  'experimental_useSidebarThreadActions',
] as const;

describe('the kit', () => {
  test('the stable participants carry no marker', () => {
    for (const name of STABLE_HOOKS) {
      expect(typeof (kit as Record<string, unknown>)[name]).toBe('function');
      // No unprefixed twin: a surface that exists under BOTH names is a second
      // thing to keep in step, and the marker would mean nothing.
      expect((kit as Record<string, unknown>)[`experimental_${name}`]).toBeUndefined();
    }
  });

  test('the sidebar hooks carry the marker, and no unprefixed twin', () => {
    for (const name of EXPERIMENTAL_HOOKS) {
      expect(typeof (kit as Record<string, unknown>)[name]).toBe('function');
      const unprefixed = name.replace(/^experimental_/, '');
      expect((kit as Record<string, unknown>)[unprefixed]).toBeUndefined();
    }
  });
});

describe('the SDK app surface', () => {
  test('the provider-icon registration is marked experimental, on the METHOD', async () => {
    // The registration method is what a plugin author writes, so the marker has
    // to be on the METHOD — the slot NAME stays bare because it is the store key
    // and the resolver's lookup, and renaming it would churn the resolver for a
    // prefix that only means anything to a reader of the API.
    // Imported by PATH, not from the package barrel: this is the host-side
    // registrar a plugin's `setup` is handed, and it is deliberately not part of
    // the published testing surface.
    const { createListRegistrar, emptyListRegistrations } = await import('./testing/list-slots');
    const registrar = createListRegistrar(emptyListRegistrations);

    expect(typeof registrar.experimental_providerIcon).toBe('function');
    // No unprefixed twin, for the reason the hooks give: two names for one
    // surface is a second thing to keep in step.
    expect((registrar as unknown as Record<string, unknown>).providerIcon).toBeUndefined();
  });

  test('LIST_SLOT_NAMES holds slot KEYS, never the experimental method names', () => {
    // The store key and the API name are different things, and conflating them
    // would put a stability marker in a data structure that never leaves the
    // host.
    for (const name of sdk.LIST_SLOT_NAMES as readonly string[]) {
      expect(name.startsWith('experimental_')).toBe(false);
    }
  });
});
