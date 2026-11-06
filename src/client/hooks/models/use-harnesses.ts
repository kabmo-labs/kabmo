/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness catalog as ONE shared store, not one store per hook call.
 *
 * `GET /api/harness` is read by two mounted surfaces at once — the composer's
 * tab strip and Settings → Harnesses — and they used to hold a `useState` each.
 * Probes then lived in whichever instance ran them: pressing **Check status** on
 * `opencode2` wrote the 96 models into the SETTINGS copy, and the picker went on
 * showing "This harness has not reported its models yet" until the page was
 * reloaded. Measured in a browser: probe in Settings, switch to the composer,
 * zero rows; reload, 96 rows. The answer only looked fresh because the SERVER
 * cached it and the new page load re-read the cache.
 *
 * The store is module state for the reason the rest of this codebase states: it
 * is a property of the installed agents, shared by every surface on the page.
 * `probe()` therefore notifies every subscriber instead of returning a value one
 * caller happens to keep.
 */

import { useEffect, useState } from 'preact/hooks';
import type { HarnessConfig, HarnessProviderSupport, HarnessesPayload, HarnessSummary } from '@/shared/types/harness';

export interface HarnessesController {
  harnesses: HarnessSummary[];
  /** Per-harness config, keyed by id. Empty until the catalog is read. */
  configs: Record<string, HarnessConfig>;
  /** Persist one harness's config; resolves to the server's refusal, or null. */
  saveConfig: (id: string, config: HarnessConfig) => Promise<string | null>;
  /** What each harness can do about other providers, keyed by id. */
  providerSupport: Record<string, HarnessProviderSupport>;
  /** Copy one provider from a source registry into a harness.
   *
   *  The ROW travels with the id: the writer needs the endpoint, dialect and
   *  model list, and the server would otherwise have to look them up again. The
   *  credential is not in the row — the server reads that from the source file. */
  importProvider: (
    id: string,
    sourceId: string,
    entry: HarnessProviderSupport['importable'][number],
  ) => Promise<string | null>;
  isLoading: boolean;
  error: string | null;
  /** Re-read the catalog. */
  reload: () => void;
  /** Probe one harness (spawns that agent once) and merge the answer in. */
  probe: (id: string, cwd?: string) => Promise<string | null>;
}

interface HarnessStore {
  harnesses: HarnessSummary[];
  configs: Record<string, HarnessConfig>;
  providerSupport: Record<string, HarnessProviderSupport>;
  isLoading: boolean;
  error: string | null;
  /** Bumped on every change, so `useSyncExternalStore`-style subscribers can
   *  detect it without holding the arrays themselves. */
  version: number;
}

const store: HarnessStore = {
  harnesses: [], configs: {}, providerSupport: {}, isLoading: true, error: null, version: 0,
};
/** Has the catalog been read at least once? A later mount must NOT re-fetch: the
 *  answer is a property of the installed agents, and `reload()` is the explicit
 *  way to re-read it. */
let loaded = false;
const listeners = new Set<() => void>();
/** One in-flight catalog read shared by every mount; a second mount joins it
 *  rather than firing its own `GET /api/harness`. */
let inflight: Promise<void> | null = null;

function emit(patch: Partial<HarnessStore>): void {
  Object.assign(store, patch);
  store.version += 1;
  for (const listener of listeners) listener();
}

async function loadCatalog(): Promise<void> {
  if (inflight) return inflight;
  if (loaded) return;
  emit({ isLoading: true });
  inflight = fetch('/api/harness')
    .then(async (response) => {
      if (!response.ok) throw new Error(`GET /api/harness answered ${response.status}`);
      return (await response.json()) as HarnessesPayload;
    })
    .then((payload) => {
      loaded = true;
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
    });
  return inflight;
}

/** One probe, shared: the settings page's "check status" and the tab strip's
 *  click on a blocked harness both land here. Returns the agent's own refusal,
 *  or null on success. */
async function probeHarness(id: string, cwd?: string): Promise<string | null> {
  try {
    const response = await fetch('/api/harness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probe: id, ...(cwd ? { cwd } : {}) }),
    });
    const payload = (await response.json()) as { probe?: HarnessSummary['probe']; error?: string };
    if (!response.ok || !payload.probe) return payload.error ?? `Probe failed (HTTP ${response.status})`;
    const probed = payload.probe;
    emit({
      harnesses: store.harnesses.map((entry) => (entry.id === id ? { ...entry, probe: probed } : entry)),
    });
    return probed.capabilities.blocked ?? null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Probe failed';
  }
}

/**
 * Save one harness's config and fold the server's answer back in.
 *
 * The server's shape, not the draft's: a value it normalised (or refused) must
 * be what the card shows next, or the form and the spawn disagree.
 */
async function saveHarnessConfig(id: string, config: HarnessConfig): Promise<string | null> {
  try {
    const response = await fetch('/api/harness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probe: id, config }),
    });
    const payload = (await response.json()) as {
      config?: HarnessConfig;
      probeInvalidated?: boolean;
      error?: string;
    };
    if (!response.ok || !payload.config) return payload.error ?? `Save failed (HTTP ${response.status})`;
    emit({ configs: { ...store.configs, [id]: payload.config } });
    // The SERVER decides whether the last probe still describes this harness —
    // only a changed command or env does not. Nulling it on every save collapsed
    // the provider/model pickers into free-text fields the moment a default was
    // stored.
    if (payload.probeInvalidated) {
      emit({ harnesses: store.harnesses.map((entry) => (entry.id === id ? { ...entry, probe: null } : entry)) });
    }
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Save failed';
  }
}

/**
 * Copy one provider out of a source registry into a harness.
 *
 * The CREDENTIAL never travels from the browser: only the source id does, and
 * the route reads the key out of the source file in the same request that writes
 * the target.
 */
async function importProvider(
  id: string,
  sourceId: string,
  entry: HarnessProviderSupport['importable'][number],
): Promise<string | null> {
  try {
    const response = await fetch('/api/harness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        probe: id,
        importProvider: {
          from: entry.source,
          id: sourceId,
          entry: { name: entry.name, baseUrl: entry.baseUrl, dialect: entry.dialect, models: entry.models },
        },
      }),
    });
    const payload = (await response.json()) as {
      imported?: { id: string; replaced: boolean };
      config?: HarnessConfig;
      error?: string;
    };
    if (!response.ok) return payload.error ?? `Import failed (HTTP ${response.status})`;
    // An env-style target answered with a CONFIG; a registry target with the id
    // it wrote. Both change what the card shows, so both are folded back in.
    if (payload.config) emit({ configs: { ...store.configs, [id]: payload.config } });
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Import failed';
  }
}

export function useHarnesses(): HarnessesController {
  const [snapshot, setSnapshot] = useState(() => ({ ...store }));

  useEffect(() => {
    const sync = () => setSnapshot({ ...store });
    listeners.add(sync);
    // A subscriber that arrives after the first read has to see the catalog the
    // first one already loaded, or the second surface renders empty forever.
    sync();
    void loadCatalog();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  return {
    harnesses: snapshot.harnesses,
    configs: snapshot.configs,
    saveConfig: saveHarnessConfig,
    providerSupport: snapshot.providerSupport,
    importProvider,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    reload: () => {
      loaded = false;
      void loadCatalog();
    },
    probe: probeHarness,
  };
}

/**
 * Forget everything this process learned about the harnesses.
 *
 * Two callers, one meaning: a test file starts from a cold store, and
 * `bun --hot` re-evaluates this module while the old store may still describe
 * agents that have since been installed or removed.
 */
export function resetHarnessesStore(): void {
  inflight = null;
  loaded = false;
  Object.assign(store, {
    harnesses: [], configs: {}, providerSupport: {}, isLoading: true, error: null, version: 0,
  });
  for (const listener of listeners) listener();
}
