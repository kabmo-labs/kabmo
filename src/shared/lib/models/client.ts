/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared client for GET /api/models. Dedupes concurrent callers onto a single
 * in-flight request and caches the result for 60s (mirroring the server-side
 * cache TTL), so mounting ChatInput + ModelDropdown together costs one fetch.
 */

import type { AIModelOption, ModelsData } from '@/shared/types';
import { realtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_MODELS } from '@/shared/lib/realtime/protocol';

const CACHE_TTL_MS = 60_000;

/** GET /api/models response: ModelsData (real mode) + mock-mode extras. */
export type ModelsResponse = ModelsData & { selectedModel?: AIModelOption };

let inFlight: Promise<ModelsResponse> | null = null;
let cached: { data: ModelsResponse; expiresAt: number } | null = null;
/** Bumped by every invalidation, so a read that began earlier cannot answer it. */
let generation = 0;

export function fetchModelsData(): Promise<ModelsResponse> {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);
  if (inFlight) return inFlight;

  const startedAt = generation;
  const request = fetch('/api/models')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`GET /api/models failed: ${res.status}`))))
    .then((data: ModelsResponse) => {
      // A read that began BEFORE an invalidation describes the catalog that
      // invalidation retired. Caching it would serve the pre-write list for
      // another minute — the stale-picker bug itself — so only a read from the
      // current generation may write the cache.
      if (startedAt === generation) cached = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      return data;
    })
    .finally(() => {
      // Identity, not a flag: a newer read may already own `inFlight`.
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}

/**
 * Drop the local cache, and any read that started before the drop.
 *
 * The in-flight half matters twice. `inFlight` is module state shared by every
 * consumer, so a read started against the previous catalog would otherwise be
 * handed to a caller that invalidated on purpose — and a read that never
 * settles (a stub, a hung socket, a request the page abandoned) would leave
 * every later caller waiting on that same promise forever. Measured on the
 * Ubuntu gate: the picker suites timed out at the runner's 5 s budget, one
 * file after another, with a healthy stub installed and never consulted.
 */
export function invalidateModelsCache(): void {
  cached = null;
  generation += 1;
  inFlight = null;
}

/**
 * Drop the local cache so the next read goes to the server.
 *
 * The server republishes the `models` topic on the same write (see
 * `invalidateModelsCaches`), so every consumer — this tab and every other —
 * re-reads from one signal rather than from a local event.
 */
export function notifyModelsUpdated(): void {
  invalidateModelsCache();
}

/**
 * Observe the `models` topic. The callback fires when the catalog changed, so
 * the caller can re-project its own view from `fetchModelsData`.
 *
 * The local cache is dropped BEFORE the handler runs: the event exists because
 * the server's answer changed, and a 60s answer cached before it would otherwise
 * be handed straight back to a handler that is trying to re-read the catalog
 * (measured: adding a provider left the composer's picker on the old list until
 * the page was reloaded, even though the topic had fired).
 */
export function subscribeModelsUpdated(handler: () => void): () => void {
  return realtimeClient.subscribe(TOPIC_MODELS, () => {
    invalidateModelsCache();
    handler();
  });
}
