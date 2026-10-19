/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which installed panel plugins are switched ON.
 *
 * Enablement is separate from installation on purpose: a plugin's files can be
 * on disk while it contributes nothing — no activity-bar button, no header
 * button, no editor tab — and that is the state a user reaches by switching a
 * plugin off rather than deleting it. Deleting is `removePanelPlugin`; this
 * only flips a flag.
 *
 * The flag lives in Kabmo's own `app_settings` rather than in the
 * marketplace directory, because it is Kabmo state: the plugin's files are a
 * third-party repository whose format Kabmo does not own, and writing a
 * Kabmo preference into it would be a file the plugin's own tooling could
 * rewrite.
 *
 * Stored as the DISABLED set, not an enabled set. Absent means enabled, which
 * is what makes a freshly installed plugin live immediately and what keeps a
 * database written before this feature existed from switching every plugin off.
 */

import { getDb } from '@/server/db.server';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import { LEGACY_SETTINGS_BLOB_KEY } from '@/shared/lib/settings/keys';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

/** `app_settings` key holding the disabled plugin ids. */
const PANEL_PLUGINS_KEY = 'omp_panel_plugins';

/** The Kabmo settings blob, which used to hold the HIDDEN panel ids. */
const SETTINGS_BLOB_KEY = 'kabmo_settings';

interface PanelPluginState {
  /** Plugin ids whose contributions are switched off. */
  disabled: string[];
  /**
   * Whether git-installed plugins are updated automatically.
   *
   * Kabmo state, like the disabled set, and stored in the same blob: it is a
   * preference about what Kabmo does, not a property of any plugin
   * directory, and writing it into a plugin's own files would put it where that
   * plugin's tooling could rewrite it.
   *
   * Absent means OFF. An automatic update runs `git fetch` and a hard reset
   * against a remote, so it must be something the user turned on rather than
   * something that starts happening on upgrade.
   */
  autoUpdate: boolean;
}

const EMPTY: PanelPluginState = { disabled: [], autoUpdate: false };

function normalize(raw: unknown): PanelPluginState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY;
  const record = raw as Record<string, unknown>;
  const list = record.disabled;
  return {
    disabled: Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string' && id.length > 0) : [],
    autoUpdate: record.autoUpdate === true,
  };
}

/**
 * Fold the retired `hiddenRightPanels` list into the disabled set, once.
 *
 * Hiding a panel and disabling it were two different things with two different
 * stores, and hiding was the built-ins' only axis. There is now ONE axis and one
 * store, so a list of hidden ids has to become a list of disabled ones or a view
 * the user had switched off would come back on their next load.
 *
 * The migration is guarded by the PRESENCE of the old key rather than by a
 * marker, and it deletes the key as it goes: a marker would leave the list in
 * place for a database that migrated under an older build, and deleting it is
 * what makes the pass idempotent — a second read finds nothing to fold, so a
 * value written afterwards cannot be re-adopted. Values already in the disabled
 * set win: they are the newer store.
 */
async function migrateHiddenPanels(state: PanelPluginState): Promise<PanelPluginState> {
  const db = await getDb();
  // The retired key can sit in EITHER blob: an install that predates the rename
  // wrote `omp_chamber_settings`, and the fold has to reach that row or the
  // upgrade silently resurrects every panel the user had hidden. Each blob is
  // edited in place and only when it actually carries the key, so the pass stays
  // idempotent — a second read finds nothing to fold, and a value written
  // afterwards cannot be re-adopted.
  const blobs: Array<[string, Record<string, unknown>]> = [];
  for (const key of [LEGACY_SETTINGS_BLOB_KEY, SETTINGS_BLOB_KEY]) {
    const stored = await readSettingsJson<unknown>(db, key, null);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      blobs.push([key, stored as Record<string, unknown>]);
    }
  }

  const hidden = blobs.flatMap(([, blob]) => (Array.isArray(blob.hiddenRightPanels) ? blob.hiddenRightPanels : []));
  if (hidden.length === 0) return state;

  const merged = new Set(state.disabled);
  for (const id of hidden) {
    if (typeof id === 'string' && id.length > 0) merged.add(id);
  }

  for (const [key, blob] of blobs) {
    if (!Array.isArray(blob.hiddenRightPanels)) continue;
    const { hiddenRightPanels: _retired, ...rest } = blob;
    await writeSettingsJson(db, key, rest);
  }

  const next = { disabled: [...merged], autoUpdate: state.autoUpdate };
  await writeSettingsJson(db, PANEL_PLUGINS_KEY, next);
  return next;
}

/**
 * The whole stored state, after the one-time migration.
 *
 * Read as a unit rather than per field: the blob is a single row, so two
 * readers would parse it twice and one of them would run the migration twice.
 */
async function readState(): Promise<PanelPluginState> {
  const db = await getDb();
  const stored = normalize(await readSettingsJson<unknown>(db, PANEL_PLUGINS_KEY, EMPTY));
  return migrateHiddenPanels(stored);
}

/** The ids switched off, in the order they were written. */
export async function readDisabledPlugins(): Promise<string[]> {
  return (await readState()).disabled;
}

/** Whether git-installed plugins are updated automatically. */
export async function readPluginAutoUpdate(): Promise<boolean> {
  return (await readState()).autoUpdate;
}

/** Turn automatic updating of git-installed plugins on or off. */
export async function setPluginAutoUpdate(enabled: boolean): Promise<boolean> {
  // Republished from here for the same reason the disabled set is: the flag
  // decides whether a background pass runs, and every open tab renders it.
  const current = await readState();
  const db = await getDb();
  await writeSettingsJson(db, PANEL_PLUGINS_KEY, { disabled: current.disabled, autoUpdate: enabled } satisfies PanelPluginState);
  emitRealtimeSignal('panels-changed');
  return enabled;
}

/**
 * Switch a plugin on or off, answering with the resulting disabled set.
 *
 * Idempotent by construction — the id is added or removed from a set rather
 * than toggled — so a double-click cannot leave the plugin in the state the
 * user did not ask for.
 */
export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<string[]> {
  // The `panels` topic is republished from here rather than at each route: a
  // switch flipped in one tab must move every other tab's catalog, and this is
  // the one writer of that state.
  const current = await readState();
  const disabled = current.disabled;
  const next = enabled
    ? disabled.filter((id) => id !== pluginId)
    : disabled.includes(pluginId)
      ? disabled
      : [...disabled, pluginId];
  const db = await getDb();
  await writeSettingsJson(db, PANEL_PLUGINS_KEY, { disabled: next, autoUpdate: current.autoUpdate } satisfies PanelPluginState);
  emitRealtimeSignal('panels-changed');
  return next;
}
