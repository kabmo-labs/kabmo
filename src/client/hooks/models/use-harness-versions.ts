/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Version + update state for every harness, as ONE shared store.
 *
 * Shared for the reason the harness catalog is (`use-harnesses.ts`): the About
 * modal and any future surface must not each hold their own copy, or a
 * "Check again" in one would leave the other showing yesterday's number.
 *
 * The read is CACHED until something forces it. `fetchNpmLatest` is one registry
 * request per `npm` harness — nine of them — and About is a dialog a reader opens
 * on a whim. Only the explicit "Check again" bypasses the cache.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';

/** One row, as `/api/harness/versions` answers it. */
export interface HarnessVersionRow {
  id: string;
  label: string;
  /** `npm` — a registry number exists and the install is that package.
   *  `self` — the CLI updates itself, so Kabmo reports and does not install.
   *  `own` — a vendor installer owns it. */
  kind: 'npm' | 'self' | 'own' | null;
  /** False when the agent is not on this machine: no version, no action. */
  installed: boolean;
  /** The version the PROBE reported — for an adapter, the adapter's own. */
  agentVersion: string | null;
  /** The CLI underneath an adapter, from its `--version`. The number a user
   *  recognises as "their version". */
  cli: { name: string; version: string | null } | null;
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  note: string | null;
  command: string | null;
}

interface VersionStore {
  rows: HarnessVersionRow[];
  isLoading: boolean;
  error: string | null;
  checkedAt: number | null;
}

const store: VersionStore = { rows: [], isLoading: true, error: null, checkedAt: null };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
/** Has a read happened? A second mount joins the answer instead of re-asking. */
let loaded = false;
/** Set by `refresh()`, cleared once the read starts. */
let refreshRequested = false;

function emit(patch: Partial<VersionStore>): void {
  Object.assign(store, patch);
  for (const listener of listeners) listener();
}

async function loadVersions(force: boolean): Promise<void> {
  if (inflight) return inflight;
  // `force` means "re-read the REGISTRY" (the Check button). A plain reload is
  // what an UPDATE asks for: the rows must be re-read, but the registry answers
  // inside its own cache window, so it is not forced. Skipping it because
  // `loaded` was already true is how an update left the row showing its old
  // version AND the button still enabled.
  if (loaded && !force && !refreshRequested) return;
  refreshRequested = false;
  emit({ isLoading: true });
  inflight = fetch(`/api/harness/versions${force ? '?force=1' : ''}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`GET /api/harness/versions answered ${response.status}`);
      return (await response.json()) as { harnesses?: HarnessVersionRow[]; error?: string };
    })
    .then((payload) => {
      loaded = true;
      emit({
        rows: Array.isArray(payload.harnesses) ? payload.harnesses : [],
        checkedAt: Date.now(),
        error: null,
        isLoading: false,
      });
    })
    .catch((cause: unknown) => {
      emit({
        error: cause instanceof Error ? cause.message : 'Could not read the harness versions',
        isLoading: false,
      });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export interface HarnessVersionsController {
  rows: HarnessVersionRow[];
  isLoading: boolean;
  error: string | null;
  checkedAt: number | null;
  /** `true` bypasses the registry cache — the "Check again" path. */
  reload: (force?: boolean) => void;
  /** Re-read the ROWS without forcing the registry: what an update asks for.
   *  Distinct from `reload` because that one spends a registry request per
   *  `npm` harness, and an update has already paid for the number it needs. */
  refresh: () => void;
}

export function useHarnessVersions(): HarnessVersionsController {
  const [snapshot, setSnapshot] = useState(() => ({ ...store }));

  useEffect(() => {
    const sync = () => setSnapshot({ ...store });
    listeners.add(sync);
    sync();
    // A harness that has never been probed has no version to report, so reading
    // this on mount is what turns a dash into a number after a Check status.
    void loadVersions(false);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  return {
    rows: snapshot.rows,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    checkedAt: snapshot.checkedAt,
    reload: useCallback((force = true) => {
      void loadVersions(force);
    }, []),
    refresh: useCallback(() => {
      refreshRequested = true;
      void loadVersions(false);
    }, []),
  };
}

/**
 * Forget the store. Two callers, one meaning: a test starts cold, and a probe
 * that just learned a version must not be hidden behind a stale row.
 */
export function resetHarnessVersions(): void {
  inflight = null;
  loaded = false;
  refreshRequested = false;
  Object.assign(store, { rows: [], isLoading: true, error: null, checkedAt: null });
  for (const listener of listeners) listener();
}

/** Re-read the rows after a probe, WITHOUT forcing a registry request. */
export function invalidateHarnessVersions(): void {
  refreshRequested = true;
  void loadVersions(false);
}
