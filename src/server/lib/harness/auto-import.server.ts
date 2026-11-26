/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Copy the sessions an agent already holds, without the user pressing anything.
 *
 * The manual action (`importSessions`) is one spawn per harness. Doing that on
 * the sidebar's load would start every installed agent on page open, which is
 * why probing never runs there either. This module owns a boot-and-refresh pass
 * instead:
 *
 *  - one pass per PROCESS, started by the boot wiring AFTER the probe pass (a
 *    `--hot` reload must not spawn every agent again);
 *  - the first run follows that probe, so `list` is already in the cache;
 *  - only a harness the user has NOT switched off AND keeps ON is a target —
 *    the switch is per-harness consent, and ON is the default;
 *  - only a harness whose cached probe advertises `list` is asked: a spawn
 *    that can only fail is not a discovery;
 *  - sequential, and a failure is logged and the pass continues.
 *
 * `omp-acp` is skipped: it writes omp's JSONL, which the sidebar scan already
 * lists, so importing would only add duplicate rows the merge then drops.
 */

import { getDb } from '@/server/db.server';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import { loadProbes } from '@/server/lib/harness/probe-cache.server';
import { autoProbeTargets } from '@/server/lib/harness/auto-probe.server';
import { importHarnessSessions } from '@/server/lib/harness/session-import.server';
import { isMockMode } from '@/server/mock.server';
import { harnessDescriptor, harnessIds, type HarnessId } from '@kabmo-labs/kabmo-harness-catalog';
import { ensureCustomHarnesses } from '@/server/lib/harness/custom.server';
import type { HarnessSessionImport } from '@/shared/types/harness';

declare global {
  // eslint-disable-next-line no-var
  var __kabmoHarnessAutoImportPid: number | undefined;
  /** The pass in flight, shared across a `bun --hot` module re-evaluation. */
  // eslint-disable-next-line no-var
  var __kabmoAutoImportPass: Promise<void> | null | undefined;
  /** When the last pass STARTED, for the sidebar's throttle. */
  // eslint-disable-next-line no-var
  var __kabmoAutoImportLastAt: number | undefined;
}

const AUTO_IMPORT_KEY = 'harness_auto_import_disabled';
/** The first cut stored the ENABLED ids; migrated once so a toggle made in that
 *  build is not silently reversed by the new default. */
const LEGACY_ENABLED_KEY = 'harness_auto_import';
/** One spawn per target; a terminal chat written a minute ago should appear
 *  without a restart, and a quarter-hour cadence is not a load concern. */
const AUTO_IMPORT_INTERVAL_MS = 15 * 60_000;
/** Fallback delay for a caller that starts the clock on its own; the boot
 *  wiring passes 0 because it chains the clock after the probe pass. */
const AUTO_IMPORT_FIRST_DELAY_MS = 20_000;
/** A sidebar load may trigger a pass, but not more often than this. Short
 *  enough that a terminal chat followed by a reload appears without waiting for
 *  the 15-minute tick, long enough that a chatty client cannot spawn agents. */
const AUTO_IMPORT_THROTTLE_MS = 30_000;

/**
 * Every harness id whose auto-import switch is OFF.
 *
 * The list is the EXCLUSION set, because the feature is ON by default: a fresh
 * install has no row, and every importable harness is a target. Switching one
 * off writes its id here.
 */
export async function loadAutoImportDisabled(): Promise<string[]> {
  const db = await getDb();
  const legacy = await readSettingsJson<unknown>(db, LEGACY_ENABLED_KEY, null);
  if (Array.isArray(legacy)) {
    const enabled = new Set(legacy.filter((entry): entry is string => typeof entry === 'string'));
    await ensureCustomHarnesses();
    const disabled = harnessIds().filter(
      (id) => !enabled.has(id) && id !== 'omp-rpc' && id !== 'omp-acp',
    );
    await writeSettingsJson(db, AUTO_IMPORT_KEY, disabled);
    await db.run('DELETE FROM app_settings WHERE key = ?', [LEGACY_ENABLED_KEY]);
    return disabled;
  }
  const value = await readSettingsJson<unknown>(db, AUTO_IMPORT_KEY, []);
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/** Whether one harness's switch is on. Built-ins and omp (ACP) have no toggle. */
export function autoImportEnabled(id: string, disabled: ReadonlySet<string>): boolean {
  return id !== 'omp-rpc' && id !== 'omp-acp' && !disabled.has(id);
}

/**
 * Flip one harness's auto-import switch and return the stored list.
 *
 * Throws for an unknown id and for the built-in transport: the list is the
 * user's consent, and a row no catalog descriptor names must not enter it.
 */
export async function saveAutoImportEnabled(id: string, enabled: boolean): Promise<string[]> {
  if (!harnessDescriptor(id)) throw new Error(`Unknown harness: ${id}`);
  if (harnessDescriptor(id)?.builtIn) {
    throw new Error(`${id} is built in and holds no importable session list`);
  }
  if (id === 'omp-acp') {
    throw new Error('omp (ACP) writes omp\'s own session files, which the sidebar already scans');
  }
  const current = await loadAutoImportDisabled();
  const next = enabled
    ? current.filter((entry) => entry !== id)
    : [...new Set([...current, id])];
  const db = await getDb();
  if (next.length === 0) {
    await db.run('DELETE FROM app_settings WHERE key = ?', [AUTO_IMPORT_KEY]);
    return [];
  }
  await writeSettingsJson(db, AUTO_IMPORT_KEY, next);
  return next;
}

/**
 * The harnesses this pass should ask: auto-import ON, roster ON, launchable,
 * and advertising `list` in the cached probe.
 */
export async function autoImportTargets(ids?: readonly HarnessId[]): Promise<HarnessId[]> {
  const disabled = new Set(await loadAutoImportDisabled());
  const probes = await loadProbes();
  const candidates = await autoProbeTargets(ids ? { ids } : {});
  return candidates.filter((id) => (
    autoImportEnabled(id, disabled) && probes.get(id)?.capabilities.listSessions === true
  ));
}

export interface AutoImportOutcome {
  imported: HarnessId[];
  failed: Array<{ id: HarnessId; error: string }>;
  counts: Partial<Record<HarnessId, HarnessSessionImport>>;
}

/**
 * One pass. Sequential, because every target is an agent process, and never
 * throws: the caller is a background clock, and one broken adapter must not stop
 * the others from being discovered.
 */
export async function runAutoImport(options: {
  targets?: readonly HarnessId[];
  importFn?: (id: HarnessId) => Promise<HarnessSessionImport>;
} = {}): Promise<AutoImportOutcome> {
  const outcome: AutoImportOutcome = { imported: [], failed: [], counts: {} };
  if (isMockMode()) return outcome;
  const targets = options.targets ?? await autoImportTargets();
  const importFn = options.importFn ?? importHarnessSessions;
  for (const id of targets) {
    try {
      const result = await importFn(id);
      outcome.counts[id] = result;
      if (result.imported > 0) outcome.imported.push(id);
    } catch (error) {
      outcome.failed.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcome;
}

function logPass({ imported, failed, counts }: AutoImportOutcome): void {
  const total = Object.values(counts).reduce((sum, entry) => sum + (entry?.imported ?? 0), 0);
  if (total > 0) {
    console.log(`[harness] auto-imported ${total} session(s) from ${imported.join(', ')}`);
  }
  for (const failure of failed) {
    console.error(`[harness] ${failure.id}: auto import failed — ${failure.error}`);
  }
}

/**
 * Run a pass now, unless one is in flight or the last ran within a minute.
 *
 * `force` belongs to the clock: its 15-minute tick (and the boot tick chained
 * after the probe) is the guaranteed cadence. The sidebar calls without force,
 * so opening the app after a terminal chat refreshes within a minute, not on
 * every render.
 */
export function requestAutoImport(force = false): void {
  if (globalThis.__kabmoAutoImportPass) return;
  const now = Date.now();
  if (!force && now - (globalThis.__kabmoAutoImportLastAt ?? 0) < AUTO_IMPORT_THROTTLE_MS) return;
  globalThis.__kabmoAutoImportLastAt = now;
  globalThis.__kabmoAutoImportPass = runAutoImport()
    .then(logPass)
    .catch((error) => {
      console.error('[harness] auto import skipped:', error);
    })
    .finally(() => {
      globalThis.__kabmoAutoImportPass = null;
    });
}

/**
 * Start the background clock. Idempotent per process (the boot pass and a
 * `bun --hot` reload must not stack), never awaited, and unref'd so it cannot
 * hold the process open on its own.
 */
export function startHarnessAutoImport(firstDelayMs = AUTO_IMPORT_FIRST_DELAY_MS): void {
  if (globalThis.__kabmoHarnessAutoImportPid === process.pid) return;
  globalThis.__kabmoHarnessAutoImportPid = process.pid;
  const first = setTimeout(() => requestAutoImport(true), firstDelayMs);
  first.unref?.();
  const timer = setInterval(() => requestAutoImport(true), AUTO_IMPORT_INTERVAL_MS);
  timer.unref?.();
}
