/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The boot banner's last two lines: what omp reports it can actually run.
 *
 * A live RPC round-trip, which is why the caller runs it after the listener is
 * up — a cold utility process takes seconds. The side benefit is that it warms
 * the shared utility process the model picker drives, so the first `/api/models`
 * call does not pay the spawn.
 *
 * Never throws: a detection failure is a banner line, not a reason to stop a
 * server that is already serving.
 */

import { isMockMode } from '@/server/mock.server';
import { fetchOmpRegistrySnapshot } from '@/server/lib/models/provider-registry.server';

export async function logDetectedRegistry(): Promise<void> {
  if (isMockMode()) {
    console.log('[kabmo] providers:      n/a (MOCK mode)');
    console.log('[kabmo] models:         n/a (MOCK mode)');
    return;
  }
  try {
    const { providers, models } = await fetchOmpRegistrySnapshot();
    // Count providers that actually serve a model — the distinct `provider`
    // values in the model list, i.e. the same set GET /api/models groups by.
    // omp's login catalog lists every sign-in offer it supports (75 here, 73 of
    // them without credentials); counting those would report a provider set the
    // Kabmo cannot use. The catalog size is kept as context.
    const servingProviders = new Set(models.map((model) => model.provider)).size;
    console.log(`[kabmo] providers:      ${servingProviders} detected (${providers.length} known to omp)`);
    console.log(`[kabmo] models:         ${models.length} detected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[kabmo] providers/models: detection failed — ${message}`);
  }
}
