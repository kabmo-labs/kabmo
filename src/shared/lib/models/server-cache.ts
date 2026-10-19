/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Process-wide registry caches shared by `GET /api/models` and the provider
 * settings routes. Both snapshot the omp registry for 60s, so every provider
 * mutation — connect, disconnect, model visibility, models.yml registration —
 * must drop them together. Otherwise the chat model picker keeps serving the
 * list from before the change until the TTL expires.
 */

import type { ModelsData, ProviderItem } from '@/shared/types';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

declare global {
  // eslint-disable-next-line no-var
  var __kabmoModelsCache: { data: ModelsData; expiresAt: number } | undefined;
  // eslint-disable-next-line no-var
  var __kabmoProvidersRpcCache: { data: ProviderItem[]; expiresAt: number } | undefined;
}

/**
 * Drops every cached model + provider registry snapshot, and tells the realtime
 * layer to republish the `models` topic.
 *
 * The signal rides HERE rather than at each of the ~8 call sites: every one of
 * them means "the catalog changed", and a caller that forgot it would leave
 * every open picker on the pre-change list until its cache TTL expired — the
 * exact staleness this function exists to prevent.
 */
export function invalidateModelsCaches(): void {
  globalThis.__kabmoModelsCache = undefined;
  globalThis.__kabmoProvidersRpcCache = undefined;
  emitRealtimeSignal('models-changed');
}
