/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider list's grouping rules.
 *
 * The split is what makes an unconfigured provider FINDABLE: it is the row you
 * click to sign in, not an absence. The panel used to filter those rows out, so
 * an OAuth provider that had never been signed in could not be reached from the
 * panel that signs it in.
 */

import { describe, expect, test } from 'bun:test';
import {
  groupProviders,
  providerGroupOf,
  providerStatusLabel,
} from '@/client/components/settings/categories/provider-settings/groups';
import type { ProviderItem } from '@/shared/types';

function provider(overrides: Partial<ProviderItem> & { slug: string }): ProviderItem {
  return {
    id: `id-${overrides.slug}`,
    name: overrides.slug,
    icon: overrides.slug,
    status: 'connected',
    configuredIn: 'x',
    models: [],
    ...overrides,
  };
}

describe('providerGroupOf', () => {
  test('disabled wins over a resolving credential', () => {
    // The switch that hid it has to stay reachable, so a disabled provider
    // belongs to its own section whatever its status says.
    expect(providerGroupOf(provider({ slug: 'a', disabled: true }))).toBe('disabled');
    expect(providerGroupOf(provider({ slug: 'b', status: 'disconnected' }))).toBe('signed-out');
    expect(providerGroupOf(provider({ slug: 'c' }))).toBe('connected');
  });
});

describe('groupProviders', () => {
  test('sections come in omp’s order and empty ones are dropped', () => {
    const groups = groupProviders([
      provider({ slug: 'signed', name: 'Signed' }),
      provider({ slug: 'off', name: 'Off', disabled: true }),
      provider({ slug: 'unknown', name: 'Unknown', status: 'disconnected' }),
    ]);

    expect(groups.map((group) => group.id)).toEqual(['connected', 'signed-out', 'disabled']);
  });

  test('a list with no unconfigured provider has no "not signed in" section', () => {
    const groups = groupProviders([provider({ slug: 'signed', name: 'Signed' })]);
    expect(groups.map((group) => group.id)).toEqual(['connected']);
  });

  test('rows are sorted by name inside a section', () => {
    const groups = groupProviders([
      provider({ slug: 'b', name: 'Zeta' }),
      provider({ slug: 'a', name: 'Alpha' }),
    ]);
    expect(groups[0].providers.map((entry) => entry.name)).toEqual(['Alpha', 'Zeta']);
  });

  test('the filter matches a provider name, its slug, or a model id', () => {
    const providers = [
      provider({ slug: 'anthropic', name: 'Anthropic' }),
      provider({
        slug: 'gateway',
        name: 'Gateway',
        models: [{ id: 'claude-x', name: 'Claude X', contextWindow: '', hasTools: true, hasVision: false, isVisible: true }],
      }),
    ];

    expect(groupProviders(providers, 'anthr')[0].providers.map((entry) => entry.slug)).toEqual(['anthropic']);
    // A user looking for the provider that serves a model should not have to
    // know which provider name it hides behind.
    expect(groupProviders(providers, 'claude')[0].providers.map((entry) => entry.slug)).toEqual(['gateway']);
    expect(groupProviders(providers, 'nothing')).toEqual([]);
  });
});

describe('providerStatusLabel', () => {
  // The label is the row's ONLY statement of state: the coloured dot that used
  // to carry it was removed (the section already says signed-in vs not), so a
  // wrong word here is a row with no state at all.
  test('the label names where the credential comes from', () => {
    expect(providerStatusLabel(provider({ slug: 'a', credentialOrigin: 'login' }))).toContain('OAuth');
    expect(providerStatusLabel(provider({ slug: 'b', credentialOrigin: 'environment' }))).toContain('environment');
    // An unconfigured OAuth provider says what a click will do.
    expect(providerStatusLabel(provider({ slug: 'c', status: 'disconnected', oauth: true })))
      .toContain('sign in with OAuth');
  });
});
