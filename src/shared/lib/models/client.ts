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

export function fetchModelsData(): Promise<ModelsResponse> {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);
  if (inFlight) return inFlight;

  inFlight = fetch('/api/models')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`GET /api/models failed: ${res.status}`))))
    .then((data: ModelsResponse) => {
      cached = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      return data;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function invalidateModelsCache(): void {
  cached = null;
}

/**
 * Drop the local cache so the next read goes to the server.
 *
 * The server republishes the `models` topic on the same write (see
 * `invalidateModelsCaches`), so every consumer — this tab and every other —
 * re-reads from one signal rather than from a local event.
 */
export function notifyModelsUpdated(): void {
  cached = null;
}

/**
 * Observe the `models` topic. The callback fires when the catalog changed, so
 * the caller can re-project its own view from `fetchModelsData`.
 */
export function subscribeModelsUpdated(handler: () => void): () => void {
  return realtimeClient.subscribe(TOPIC_MODELS, handler);
}
