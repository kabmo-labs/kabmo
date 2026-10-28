/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The LIST slots' store: every plugin's contributions to a slot, merged.
 *
 * Deliberately a different shape from `slots.ts`, and the difference is what
 * the two kinds of slot ARE:
 *
 * - A positional slot resolves PER PLUGIN (`rightPanelOf(slots)`), because the
 *   layout draws one plugin's panel at a time and the plugin is what identifies
 *   it.
 * - A list slot resolves ACROSS PLUGINS. A chat row's action strip shows every
 *   plugin's actions, in order, so the store's read is a merged list and the
 *   plugin id is part of each row's identity rather than its lookup key.
 *
 * Entries are keyed `pluginId\0slot\0id`, which is what makes disposal precise:
 * a plugin taking one registration back leaves every other row — including its
 * own other rows — exactly where it was. A duplicate key is refused at
 * registration (see `registerListSlot`), never replaced.
 */

import type {
  ListSlotName,
  KeyedRegistration,
} from '@kabmo-labs/kabmo-sdk';
import { GLOBALLY_KEYED_SLOTS } from '@kabmo-labs/kabmo-sdk';

/** One contributed row, with the plugin it came from already attached. */
export interface ListSlotEntry<T = KeyedRegistration> {
  pluginId: string;
  slot: ListSlotName;
  registration: T;
}

/** The rows of one slot, merged across plugins and sorted by `order`. */
export type ListSlotRows<T = KeyedRegistration> = readonly ListSlotEntry<T>[];

type Listener = () => void;

interface ListSlotState {
  /** `pluginId\0slot\0id` → the entry, so a lookup and a delete are one hit. */
  entries: Map<string, ListSlotEntry>;
  listeners: Set<Listener>;
}

/**
 * The store, anchored on `globalThis`.
 *
 * The same reason every other registry here is: under `bun --hot` this module
 * re-evaluates while loaded plugin bundles still hold the disposers they were
 * handed, and a module-level map would come back empty — every disposer would
 * then be a no-op against a registry nobody reads, and the next load would
 * double every row.
 */
declare global {
  // eslint-disable-next-line no-var
  var __kabmoPluginListSlots: ListSlotState | undefined;
}

function state(): ListSlotState {
  return (globalThis.__kabmoPluginListSlots ??= { entries: new Map(), listeners: new Set() });
}

const entryKey = (pluginId: string, slot: ListSlotName, id: string) => `${pluginId}\u0000${slot}\u0000${id}`;

function publish(): void {
  for (const listener of [...state().listeners]) listener();
}

/** Whether another plugin already claimed `id` for a globally-keyed slot. */
function claimedElsewhere(slot: ListSlotName, id: string, byPlugin: string): string | null {
  if (!GLOBALLY_KEYED_SLOTS.includes(slot)) return null;
  for (const entry of state().entries.values()) {
    if (entry.slot === slot && entry.registration.id === id && entry.pluginId !== byPlugin) return entry.pluginId;
  }
  return null;
}

/**
 * Register one row. Returns the disposer that takes exactly that row back.
 *
 * Two duplicate rules, and which applies is a property of the SLOT:
 *
 * - Within one plugin, a repeated `id` THROWS rather than replacing: the
 *   registration the plugin made first is the one it can address, and a quiet
 *   overwrite would leave a component the host draws while the plugin believes
 *   it registered something else.
 * - Across plugins, only a GLOBALLY-KEYED slot (`GLOBALLY_KEYED_SLOTS`) refuses
 *   a duplicate. A row among rows may repeat a key — two plugins each having a
 *   `copy` action is two rows, and that is the point — while a fence NAME may
 *   not: the same `omp:chart` resolving to one plugin or another by
 *   registration order is a renderer that changes when an unrelated plugin is
 *   installed.
 */
export function registerListSlot<T extends KeyedRegistration>(
  pluginId: string,
  slot: ListSlotName,
  registration: T,
): () => void {
  if (!registration || typeof registration.id !== 'string' || !registration.id) {
    throw new Error(`${slot} registration needs a non-empty id`);
  }
  const entries = state().entries;
  const key = entryKey(pluginId, slot, registration.id);
  if (entries.has(key)) throw new Error(`${slot} "${registration.id}" is already registered by this plugin`);
  const owner = claimedElsewhere(slot, registration.id, pluginId);
  if (owner) throw new Error(`${slot} "${registration.id}" is already claimed by plugin "${owner}"`);
  entries.set(key, { pluginId, slot, registration });
  publish();
  return () => {
    if (entries.delete(key)) publish();
  };
}

/** Drop every row a plugin contributed — called when its bundle is replaced. */
export function clearPluginListSlots(pluginId: string): void {
  const entries = state().entries;
  const prefix = `${pluginId}\u0000`;
  let removed = false;
  for (const key of [...entries.keys()]) {
    if (key.startsWith(prefix)) {
      entries.delete(key);
      removed = true;
    }
  }
  if (removed) publish();
}

/**
 * One slot's rows, merged across plugins.
 *
 * Ordered by `order` (absent = 0), then by plugin id, then by registration id —
 * a total order, so two plugins contributing at the same `order` still render
 * deterministically across reloads instead of following map insertion.
 */
export function listSlotRows<T extends KeyedRegistration = KeyedRegistration>(
  slot: ListSlotName,
): ListSlotRows<T> {
  const rows: ListSlotEntry<T>[] = [];
  for (const entry of state().entries.values()) {
    if (entry.slot === slot) rows.push(entry as ListSlotEntry<T>);
  }
  rows.sort((a, b) => {
    const order = (a.registration.order ?? 0) - (b.registration.order ?? 0);
    if (order !== 0) return order;
    if (a.pluginId !== b.pluginId) return a.pluginId < b.pluginId ? -1 : 1;
    return a.registration.id < b.registration.id ? -1 : a.registration.id > b.registration.id ? 1 : 0;
  });
  return rows;
}

/** Subscribe to any change, so a surface re-renders when a row appears or leaves. */
export function subscribeListSlots(listener: Listener): () => void {
  const listeners = state().listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: forget every row. */
export function resetListSlots(): void {
  state().entries.clear();
  publish();
}
