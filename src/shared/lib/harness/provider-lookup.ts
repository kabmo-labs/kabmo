/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Lookups over the measured registry table in `provider-facts.ts`.
 *
 * Split from the table so the data module stays inside the file ceiling as the
 * catalog grows; the table is the single owner of the facts, this module only
 * answers "what does this harness say" for callers that do not need every row.
 */

import {
  HARNESS_PROVIDER_FACTS,
} from '@/shared/lib/harness/provider-facts';
import type { HarnessProviderFacts } from '@/shared/lib/harness/provider-contracts';

/** The facts for a harness, or the honest "nothing to offer" record. */
export function providerFacts(id: string | null | undefined): HarnessProviderFacts {
  const entry = id ? (HARNESS_PROVIDER_FACTS as Record<string, HarnessProviderFacts | undefined>)[id] : undefined;
  return entry ?? {
    registry: {
      kind: 'none', file: null, pointer: '—',
      writable: false, baseUrlField: null, apiKeyField: null, modelsField: null,
    },
    createsChoice: false,
    importFrom: [],
    summary: 'This build knows nothing about providers for that harness.',
  };
}

/** True when the settings page should draw a registry editor. */
export function managesProviders(id: string | null | undefined): boolean {
  const registry = providerFacts(id).registry;
  return registry.writable && registry.kind !== 'env' && registry.kind !== 'none';
}
