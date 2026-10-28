/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What one installed plugin actually contributes, as its bundle registered it.
 *
 * The manifest may DECLARE slots, but a declaration is a claim: the bundle is
 * what the host imported, and a plugin can register more, fewer or different
 * slots than its manifest says. A card that showed the declaration would be
 * repeating the author's intent back at the reader; this reads the live
 * registration, and the card falls back to the declaration only for a plugin
 * whose bundle is not loaded (disabled, failed, or not built yet) — with the
 * fallback marked, so a claim never reads as a fact.
 *
 * Both stores are subscribed in ONE place. The positional slots live in
 * `slots.ts` and the list rows in `list-slots.ts`, and they publish separately:
 * a plugin that registers a panel and a message action does so in two writes,
 * so a card reading only one of them would show half its contributions for a
 * frame — or, worse, permanently if the other store's publish happened first.
 */

import { useEffect, useState } from 'preact/hooks';
import type { ListSlotName } from '@kabmo-labs/kabmo-sdk';
import { LIST_SLOT_NAMES } from '@kabmo-labs/kabmo-sdk';
import type { PanelSlotName } from '@/shared/types';
import { PANEL_SLOT_NAMES } from '@/shared/types';
import { listSlotRows, subscribeListSlots } from '@/client/lib/plugins/list-slots';
import { pluginSlotState, subscribePluginSlots } from '@/client/lib/plugins/slots';
import { listSlotLabel, positionalSlotLabel } from '@/shared/lib/panels/slot-labels';

/** One contribution, ready for a badge. */
export interface PluginContribution {
  /** Stable key for a list. */
  key: string;
  label: string;
  detail: string;
  kind: 'panel' | 'row';
  /** How many rows this plugin contributes to a list slot; 1 for a panel. */
  count: number;
  /** The title the plugin gave it, when it gave one. */
  title?: string;
}

/** Everything one plugin contributes, split by kind so a card can order it. */
export interface PluginContributions {
  /** True once the bundle's registrations have been read. */
  live: boolean;
  panels: PluginContribution[];
  rows: PluginContribution[];
}

const EMPTY: PluginContributions = { live: false, panels: [], rows: [] };

/**
 * One plugin's live contributions, read from both stores.
 *
 * Exported because it is the whole decision, and a hook cannot be asked what it
 * would return without a render: the tests drive this directly, and the hook is
 * only the subscription around it.
 */
export function readPluginContributions(pluginId: string): PluginContributions {
  const slots = pluginSlotState().slots.get(pluginId);
  if (!slots) return EMPTY;
  const panels: PluginContribution[] = [];
  for (const slot of PANEL_SLOT_NAMES) {
    if (!slots.components[slot]) continue;
    const label = positionalSlotLabel(slot);
    const title = slots.titles[slot];
    panels.push({
      key: slot,
      label: label.label,
      detail: label.detail,
      kind: 'panel',
      count: 1,
      ...(title ? { title } : {}),
    });
  }

  const rows: PluginContribution[] = [];
  for (const slot of LIST_SLOT_NAMES) {
    const count = listSlotRows(slot).filter((entry) => entry.pluginId === pluginId).length;
    if (count === 0) continue;
    const label = listSlotLabel(slot as ListSlotName);
    rows.push({ key: slot, label: label.label, detail: label.detail, kind: 'row', count });
  }

  return { live: true, panels, rows };
}

/**
 * One plugin's live contributions.
 *
 * Re-read on either store's publish, because the two are written at different
 * moments and a card must not settle on a half-read registration.
 */
export function usePluginContributions(pluginId: string): PluginContributions {
  const [state, setState] = useState<PluginContributions>(() => readPluginContributions(pluginId));
  useEffect(() => {
    setState(readPluginContributions(pluginId));
    const offSlots = subscribePluginSlots(() => setState(readPluginContributions(pluginId)));
    const offRows = subscribeListSlots(() => setState(readPluginContributions(pluginId)));
    return () => {
      offSlots();
      offRows();
    };
  }, [pluginId]);
  return state;
}

/**
 * Declared contributions, for a plugin whose bundle has not registered anything.
 *
 * Used ONLY as a fallback, and the card marks it: a manifest's `slots` is the
 * author's claim about what the plugin will do, while a live registration is
 * what it does. Falling back is still better than a card that says nothing at
 * all about a plugin the user has installed but disabled.
 */
export function declaredContributions(slots: readonly PanelSlotName[] | undefined): PluginContribution[] {
  if (!slots || slots.length === 0) return [];
  const declared = new Set(slots);
  // Ordered by the canonical table, not by the caller's array: the manifest
  // parser already normalizes it, and a second caller must not be able to list
  // the same plugin's slots in a different order.
  return PANEL_SLOT_NAMES.filter((slot) => declared.has(slot)).map((slot) => {
    const label = positionalSlotLabel(slot);
    return { key: slot, label: label.label, detail: label.detail, kind: 'panel' as const, count: 1 };
  });
}

/** The badges a card draws, live registrations first and declarations as a fallback. */
export function contributionBadges(
  contributions: PluginContributions,
  declared: readonly PanelSlotName[] | undefined,
): { items: PluginContribution[]; fromDeclaration: boolean } {
  const live = [...contributions.panels, ...contributions.rows];
  if (live.length > 0) return { items: live, fromDeclaration: false };
  const fallback = declaredContributions(declared);
  return { items: fallback, fromDeclaration: fallback.length > 0 };
}

/** Whether a plugin registers anything at all — the answer a "loaded, but…" line needs. */
export function hasContributions(contributions: PluginContributions): boolean {
  return contributions.panels.length > 0 || contributions.rows.length > 0;
}
