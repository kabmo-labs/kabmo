/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Grouping and filtering for the provider sidebar.
 *
 * omp's own `/models` hub splits its provider list the same way — signed-in
 * providers, then a "Not signed in" section, then whatever the user disabled —
 * and the split is what makes an unconfigured provider findable: it is the row
 * you click to sign in, not an absence. The panel used to filter those rows out
 * entirely, so an OAuth provider that had never been signed in could not be
 * reached from the panel that is supposed to sign it in.
 *
 * Pure functions, so the ordering rules are testable without a DOM.
 */

import type { ProviderItem } from '@/shared/types';

export type ProviderGroupId = 'connected' | 'signed-out' | 'disabled';

export interface ProviderGroup {
  id: ProviderGroupId;
  label: string;
  /** One line under the label, naming what the group is for. */
  hint?: string;
  providers: ProviderItem[];
}

/** Which section a provider belongs to. Disabled wins over everything. */
export function providerGroupOf(provider: ProviderItem): ProviderGroupId {
  if (provider.disabled === true) return 'disabled';
  if (provider.status === 'connected') return 'connected';
  return 'signed-out';
}

const GROUP_ORDER: ReadonlyArray<{ id: ProviderGroupId; label: string; hint?: string }> = [
  { id: 'connected', label: 'Signed in' },
  {
    id: 'signed-out',
    label: 'Not signed in',
    hint: 'omp knows these providers; pick one to sign in or add its key.',
  },
  { id: 'disabled', label: 'Disabled', hint: 'Hidden from the model picker.' },
];

/**
 * The sidebar's sections, in omp's order, with empty groups dropped.
 *
 * `query` filters on name, slug and every model id: a user looking for the
 * provider that serves `claude-sonnet` should not have to know it is called
 * `anthropic`.
 */
export function groupProviders(providers: ProviderItem[], query = ''): ProviderGroup[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? providers.filter((provider) => (
      provider.name.toLowerCase().includes(needle)
      || provider.slug.toLowerCase().includes(needle)
      || provider.models.some((model) => model.id.toLowerCase().includes(needle))
    ))
    : providers;

  const buckets = new Map<ProviderGroupId, ProviderItem[]>();
  for (const provider of matches) {
    const group = providerGroupOf(provider);
    const list = buckets.get(group);
    if (list) list.push(provider);
    else buckets.set(group, [provider]);
  }

  return GROUP_ORDER.flatMap((entry) => {
    const list = buckets.get(entry.id);
    if (!list || list.length === 0) return [];
    return [{
      ...entry,
      providers: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }];
  });
}

/**
 * True when `delete` can remove something: a `models.yml` entry, or Kabmo's own
 * overlay row. A provider omp discovered from an endpoint — and one it
 * authenticates from the environment — has neither, so the server refuses and
 * the control must not promise otherwise.
 */
export function providerDeletable(provider: ProviderItem): boolean {
  return provider.inModelsYml === true || provider.inOverlay === true;
}

/** A short reason for the row's title attribute, so the dot is not the only cue. */
export function providerStatusLabel(provider: ProviderItem): string {
  if (provider.disabled === true) return 'Disabled — hidden from the model picker';
  if (provider.status === 'connected') {
    switch (provider.credentialOrigin) {
      case 'models.yml': return 'Signed in — key stored in models.yml';
      case 'login': return 'Signed in — OAuth credential stored by omp';
      case 'api-key': return 'Signed in — API key stored by omp';
      case 'environment': return 'Signed in — credential comes from the environment';
      default: return 'Signed in';
    }
  }
  return provider.oauth === true
    ? 'Not signed in — pick this row to sign in with OAuth'
    : 'Not signed in — no credential omp can resolve';
}
