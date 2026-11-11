/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness catalog's module-level store and its one read.
 *
 * Split from `use-harnesses.ts` so the hook holds the controller and this file
 * holds the state, the shared in-flight read and the invalidation generation.
 * Two mounted surfaces — the composer's tab strip and Settings → Harnesses — read
 * `/api/harness` at once, and probes used to live in whichever instance ran them;
 * one store is what makes a probe visible everywhere without a reload.
 */

import type {
  HarnessConfig, HarnessProviderSupport, HarnessesPayload, HarnessSummary, LiveHarnessModels,
} from '@/shared/types/harness';
import { registerHarnessDescriptors } from '@/shared/lib/harness/catalog';

export interface HarnessStore {
  harnesses: HarnessSummary[];
  configs: Record<string, HarnessConfig>;
  providerSupport: Record<string, HarnessProviderSupport>;
  liveModels: Record<string, LiveHarnessModels>;
  isLoading: boolean;
  error: string | null;
  /** Bumped on every change, so `useSyncExternalStore`-style subscribers can
   *  detect it without holding the arrays themselves. */
  version: number;
}

export const store: HarnessStore = {
  harnesses: [], configs: {}, providerSupport: {}, liveModels: {}, isLoading: true, error: null, version: 0,
};
/** Has the catalog been read at least once? A later mount must NOT re-fetch: the
 *  answer is a property of the installed agents, and `reload()` is the explicit
 *  way to re-read it. */
let loaded = false;
export const listeners = new Set<() => void>();
/** One in-flight catalog read shared by every mount; a second mount joins it
 *  rather than firing its own `GET /api/harness`. */
let inflight: Promise<void> | null = null;
/**
 * Bumped by every invalidation. A read that was ALREADY IN FLIGHT when one
 * landed answers from the state before the write (the `models` frame routinely
 * arrives during the mount's own read), so joining it would leave the picker on
 * the old catalog until the next explicit reload. The read re-runs instead.
 */
let generation = 0;

export function emit(patch: Partial<HarnessStore>): void {
  Object.assign(store, patch);
  store.version += 1;
  for (const listener of listeners) listener();
}

/** Drop the cached answer and read again, even if a read is still in flight. */
export function invalidateCatalog(): Promise<void> {
  loaded = false;
  generation += 1;
  return loadCatalog();
}

export async function loadCatalog(): Promise<void> {
  if (inflight) return inflight;
  if (loaded) return;
  const stamp = generation;
  emit({ isLoading: true });
  inflight = fetch('/api/harness')
    .then(async (response) => {
      if (!response.ok) throw new Error(`GET /api/harness answered ${response.status}`);
      return (await response.json()) as HarnessesPayload;
    })
    .then((payload) => {
      loaded = true;
      // A user-added harness has no entry in the build's static catalog, and the
      // glyph/badge helpers are synchronous. Publish the descriptors the server
      // answered before any surface renders a row for one.
      registerHarnessDescriptors(
        (payload.harnesses ?? [])
          .filter((entry) => entry.custom)
          .map((entry) => ({
            id: entry.id,
            label: entry.label,
            initial: entry.initial ?? entry.label.charAt(0).toUpperCase(),
            transport: entry.transport,
            glyph: 'custom' as const,
          })),
      );
      emit({
        harnesses: Array.isArray(payload.harnesses) ? payload.harnesses : [],
        // Absent from an answer written before per-harness config existed: an
        // empty map is the honest reading, and every card then shows "not set".
        configs: payload.configs ?? {},
        providerSupport: payload.providerSupport ?? {},
        error: null,
        isLoading: false,
      });
    })
    .catch((cause: unknown) => {
      emit({
        error: cause instanceof Error ? cause.message : 'Could not read the harness list',
        isLoading: false,
      });
    })
    .finally(() => {
      inflight = null;
      // A write landed while this read was in flight: the answer just stored
      // describes the pre-write state, so read once more rather than keep it.
      if (stamp !== generation) void invalidateCatalog();
    });
  return inflight;
}

/** Forget everything this process learned about the harnesses.
 *
 *  Two callers, one meaning: a test file starts from a cold store, and
 *  `bun --hot` re-evaluates this module while the old store may still describe
 *  agents that have since been installed or removed.
 */
export function resetHarnessesStore(): void {
  inflight = null;
  loaded = false;
  Object.assign(store, {
    harnesses: [], configs: {}, providerSupport: {}, liveModels: {}, isLoading: true, error: null, version: 0,
  });
  for (const listener of listeners) listener();
}
