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
import type { HarnessConfig, HarnessSummary, LiveHarnessModels } from '@/shared/types/harness';
import type { HarnessesController } from '@/client/hooks/models/use-harnesses-controller';
import {
  emit, invalidateCatalog, listeners, loadCatalog, store,
} from '@/client/hooks/models/harness-catalog';
import { addProvider, importProvider } from '@/client/hooks/models/provider-writes';
import { subscribeModelsUpdated } from '@/shared/lib/models/client';

/**
 * Record the selectors a LIVE chat published for its harness.
 *
 * Called by the session loader on every session read, so the guard matters: an
 * unchanged list must not notify every picker subscriber (the metadata refresh
 * runs a few times per chat).
 */
export function publishLiveModels(id: string, live: LiveHarnessModels): void {
  if (!id || live.models.length === 0) return;
  const current = store.liveModels[id];
  if (current && sameSelectors(current, live)) return;
  emit({ liveModels: { ...store.liveModels, [id]: live } });
}

function sameSelectors(a: LiveHarnessModels, b: LiveHarnessModels): boolean {
  const keys = (list?: readonly { value: string; name: string }[]) =>
    (list ?? []).map((entry) => `${entry.value}\u0000${entry.name}`).join('\u0001');
  return a.models.length === b.models.length
    && keys(a.models) === keys(b.models)
    && keys(a.thinking) === keys(b.thinking);
}

/** Fold a landed provider write back into the store and re-read the catalog. */
function announceProviderWrite(
  id: string,
  config?: HarnessConfig,
  probeInvalidated?: readonly string[],
): void {
  if (config) emit({ configs: { ...store.configs, [id]: config } });
  // The write landed in a FILE, which is the only thing that proves it, so the
  // list is re-read rather than patched: a card that kept the previous list would
  // show "nothing added" after a successful add. The store caches its first
  // answer on purpose, so the re-read has to clear it.
  void invalidateCatalog().then(() => {
    // The server names every tab whose probe measured the OLD file. Ask each
    // launchable one to answer now, so the picker offers the new models without
    // a manual "Check status". The built-in transport has no agent to probe.
    for (const target of probeInvalidated ?? []) {
      const entry = store.harnesses.find((harness) => harness.id === target);
      if (!entry || entry.builtIn || entry.unavailable) continue;
      void probeHarness(target);
    }
  });
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
 * Switch one harness on or off.
 *
 * The server owns the roster (it is the only writer of `omp_harness_disabled`),
 * so its answer is folded back in rather than the draft: a refusal has to leave
 * the switch where the server actually has it.
 *
 * The switch SUCCEEDS for an agent that is not installed — that is a roster
 * decision, and the user may want the tab before they install the binary. A
 * probe rides the same response only when the server could actually run one, so
 * an absent `probe` means "nothing new was measured", never "the switch failed".
 */
async function setHarnessEnabled(id: string, enabled: boolean): Promise<string | null> {
  try {
    const response = await fetch('/api/harness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probe: id, enabled }),
    });
    const payload = (await response.json()) as {
      enabled?: boolean;
      probe?: HarnessSummary['probe'];
      error?: string;
    };
    if (!response.ok || typeof payload.enabled !== 'boolean') {
      return payload.error ?? `Switch failed (HTTP ${response.status})`;
    }
    emit({
      harnesses: store.harnesses.map((entry) => {
        if (entry.id !== id) return entry;
        const next = { ...entry, enabled: payload.enabled as boolean };
        // An absent probe means the server measured nothing: either this was a
        // switch OFF, or the binary is not installed so it did not spawn one.
        // Neither says anything about what the agent can do, so the stored
        // record stays exactly as it was.
        return payload.probe === undefined ? next : { ...next, probe: payload.probe };
      }),
    });
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Switch failed';
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
    // A provider/model write republishes the `models` topic. The ACP pickers read
    // PROBES, which the server refreshed on the same write, so the cached
    // catalog is stale in exactly the same way the model list is.
    const offModels = subscribeModelsUpdated(() => {
      void invalidateCatalog();
    });
    return () => {
      listeners.delete(sync);
      offModels();
    };
  }, []);

  return {
    harnesses: snapshot.harnesses,
    configs: snapshot.configs,
    saveConfig: saveHarnessConfig,
    providerSupport: snapshot.providerSupport,
    liveModels: snapshot.liveModels,
    importProvider: (id, sourceId, entry) => importProvider(id, sourceId, entry, announceProviderWrite),
    addProvider: (id, input) => addProvider(id, input, announceProviderWrite),
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    reload: () => {
      void invalidateCatalog();
    },
    probe: probeHarness,
    setEnabled: setHarnessEnabled,
  };
}
