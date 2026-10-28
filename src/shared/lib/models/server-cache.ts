/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Process-wide registry caches shared by `GET /api/models` and the provider
 * settings routes. Both snapshot the omp registry for 60s, so every provider
 * mutation — connect, disconnect, model visibility, models.yml registration —
 * must drop them together. Otherwise the chat model picker keeps serving the
 * list from before the change until the TTL expires.
 */

import type { ModelsData } from '@/shared/types';
import type { ModelRoleCandidate } from '@/shared/types/model-roles';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

declare global {
  // eslint-disable-next-line no-var
  var __kabmoModelsCache: { data: ModelsData; expiresAt: number } | undefined;
  /**
   * The `get_login_providers` snapshot (`provider-registry.server.ts`). Declared
   * there, because it holds omp's login-provider rows rather than ProviderItems
   * — the panel's rows are assembled per request from these plus models.yml.
   */
  // eslint-disable-next-line no-var
  var __kabmoLoginProvidersCache: { data: unknown[]; expiresAt: number } | undefined;
  /**
   * The role dropdowns' candidate list (`lib/model-roles/catalog.server.ts`).
   * Declared HERE because it is dropped by the same signal: a model removed
   * from models.yml, or a provider that lost its credential, must leave the
   * role pickers too — otherwise they keep offering a selector omp can no
   * longer resolve.
   */
  // eslint-disable-next-line no-var
  var __kabmoRoleCandidatesCache: { data: ModelRoleCandidate[]; expiresAt: number } | undefined;
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
  globalThis.__kabmoLoginProvidersCache = undefined;
  globalThis.__kabmoRoleCandidatesCache = undefined;
  emitRealtimeSignal('models-changed');
}
