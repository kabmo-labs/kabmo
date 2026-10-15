/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The recorded baseline of each installed bundled plugin, and the last sync a
 * local edit blocked.
 *
 * Both live in `app_settings` rather than in the marketplace directory, for the
 * reason the enablement flag does: they are CHAMBER state about a directory the
 * chamber happens to have written, not a property of the plugin. A file inside
 * the plugin would also be a file its own tooling could rewrite — and, worse,
 * would change the very tree the baseline describes.
 *
 * Read by the SYNC path only, never by the scan: the baseline is a hash per file
 * per plugin, and the scan answers every `/api/panels` request. What the scan
 * needs is the much smaller "this plugin was blocked" record, which is why the
 * two are separate keys.
 */

import { getDb } from '@/server/db.server';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import type { TrackedFileHashes } from '@/server/lib/panels/local-edits.server';

/** `app_settings` key holding the per-plugin file baselines. */
const BASELINES_KEY = 'omp_panel_plugin_baselines';

/** `app_settings` key holding the plugins a local edit blocked from syncing. */
const BLOCKED_KEY = 'omp_panel_plugin_sync_blocked';

/** Why a plugin's bundled sync did not run. */
export interface SyncBlockedRecord {
  /** When the sync was refused. */
  at: number;
  /** The tracked files that differ from the baseline, sorted. */
  changed: string[];
}

function asHashMap(value: unknown): TrackedFileHashes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: TrackedFileHashes = {};
  for (const [path, hash] of Object.entries(value as Record<string, unknown>)) {
    if (path && typeof hash === 'string') out[path] = hash;
  }
  return out;
}

/**
 * Every plugin's recorded baseline, keyed by plugin id.
 *
 * An EMPTY entry is kept rather than dropped. It means "recorded, and the install
 * genuinely wrote no tracked files", which is a different answer from "never
 * recorded" — the second is a plugin the check cannot apply to, and the sync must
 * fall back to running. Collapsing them would either block a plugin forever or
 * skip the check on one that has a baseline.
 */
export async function readBaselines(): Promise<Record<string, TrackedFileHashes>> {
  const db = await getDb();
  const raw = await readSettingsJson<unknown>(db, BASELINES_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, TrackedFileHashes> = {};
  for (const [pluginId, hashes] of Object.entries(raw as Record<string, unknown>)) {
    if (pluginId) out[pluginId] = asHashMap(hashes);
  }
  return out;
}

/** One plugin's baseline, or null when it was never recorded. */
export async function readBaseline(pluginId: string): Promise<TrackedFileHashes | null> {
  return (await readBaselines())[pluginId] ?? null;
}

/**
 * Record a plugin's baseline, replacing whatever was there.
 *
 * A plugin with no tracked files is recorded as an EMPTY entry rather than
 * dropped, so "recorded and genuinely empty" stays distinguishable from "never
 * recorded" — the first means an install wrote nothing, the second means this
 * feature predates the install and the sync must fall back to running.
 */
export async function writeBaseline(pluginId: string, hashes: TrackedFileHashes): Promise<void> {
  const db = await getDb();
  const all = await readBaselines();
  await writeSettingsJson(db, BASELINES_KEY, { ...all, [pluginId]: hashes });
}

/** Forget a plugin's baseline — a removal, so a reinstall starts clean. */
export async function clearBaseline(pluginId: string): Promise<void> {
  const db = await getDb();
  const all = await readBaselines();
  if (!(pluginId in all)) return;
  const { [pluginId]: _removed, ...rest } = all;
  await writeSettingsJson(db, BASELINES_KEY, rest);
}

/** The plugins a local edit blocked from syncing, keyed by plugin id. */
export async function readBlockedSyncs(): Promise<Record<string, SyncBlockedRecord>> {
  const db = await getDb();
  const raw = await readSettingsJson<unknown>(db, BLOCKED_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, SyncBlockedRecord> = {};
  for (const [pluginId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!pluginId || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as { at?: unknown; changed?: unknown };
    const changed = Array.isArray(record.changed)
      ? record.changed.filter((path): path is string => typeof path === 'string')
      : [];
    out[pluginId] = { at: typeof record.at === 'number' ? record.at : 0, changed };
  }
  return out;
}

/** Record that a local edit blocked one plugin's sync, or clear that record. */
export async function writeBlockedSync(pluginId: string, record: SyncBlockedRecord | null): Promise<void> {
  const db = await getDb();
  const all = await readBlockedSyncs();
  const next = { ...all };
  if (record) next[pluginId] = record;
  else delete next[pluginId];
  await writeSettingsJson(db, BLOCKED_KEY, next);
}
