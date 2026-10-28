/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Panel ids: the built-in views plus the panels plugin code contributes.
 *
 * A plugin panel's id is `plugin:<pluginId>:<slot>` — one string the layout
 * stores, keys widths by, and resolves a component from. One plugin contributes
 * at most one panel PER SLOT (`rightPanel`, `panel`), and a plugin may register
 * both: `marketplace/plugins/session-info` ships a `rightPanel` and a `panel`.
 * The slot segment is what keeps those two apart.
 *
 * It was not always. The id used to carry a panel segment, then dropped it on the
 * claim that a plugin contributes at most one panel — true per slot, false per
 * plugin. With the editor column's slot reachable again, one id for both would
 * make them one entry in the enablement set, one width and one placement, so
 * moving a plugin's right panel would move its editor panel with it.
 *
 * The BARE form is the one that shipped and is still accepted, resolving to the
 * `rightPanel` slot — see {@link migrateLegacyPanelId}. Writers emit the
 * segmented form; readers accept both.
 */

import { RIGHT_PANEL_TYPES, type RightPanelType } from '@/shared/lib/workspace/right-panels';

/** Prefix every plugin-contributed panel id carries. */
export const PLUGIN_PANEL_PREFIX = 'plugin:';

/**
 * The slots a plugin can contribute a panel to.
 *
 * NOT `headerPanel`/`settingsSection`: those are not panels — one is a navbar
 * entry, the other a settings block — and neither keys a width or a placement.
 */
export const PLUGIN_PANEL_SLOTS = ['rightPanel', 'panel'] as const;

export type PluginPanelSlot = (typeof PLUGIN_PANEL_SLOTS)[number];

/** The slot a bare `plugin:<id>` names: the form that shipped. */
/** The slot a bare `plugin:<id>` names, where an INSTANCE key is expected. */
export const LEGACY_PLUGIN_SLOT: PluginPanelSlot = 'rightPanel';

/**
 * `plugin:<pluginId>:<slot>` — ONE PANEL of a plugin.
 *
 * The key every panel-shaped store uses: the width map, the dock placement, the
 * stored order and the active selection. Two panels of one plugin are two panels
 * here, which is the whole point.
 */
export function pluginPanelKey(pluginId: string, slot: PluginPanelSlot): string {
  return `${PLUGIN_PANEL_PREFIX}${pluginId}:${slot}`;
}

/**
 * `plugin:<pluginId>` — the PLUGIN, not a panel.
 *
 * Separate from {@link pluginPanelKey} on purpose. Enablement is per PLUGIN: the
 * Settings switch says "Disable <plugin>" and the server gates that plugin's
 * BUNDLE on this key, so one switch has to be one id no matter how many panels
 * the plugin contributes. Making enablement per panel would leave a plugin whose
 * bundle is still served while half its panels are "off".
 *
 * This is also the form that shipped, so every stored disabled row still names a
 * plugin and needs no migration.
 */
export function pluginEnablementKey(pluginId: string): string {
  return `${PLUGIN_PANEL_PREFIX}${pluginId}`;
}

function isSlot(value: string): value is PluginPanelSlot {
  return (PLUGIN_PANEL_SLOTS as readonly string[]).includes(value);
}

/**
 * Whether a value is one of the two PLACEABLE slot names.
 *
 * A card reads a contribution's slot name to decide whether it can offer a
 * placement control, and the name arrives as a plain string — this is the
 * narrowing, rather than a cast at the call site.
 */
export function isPluginPanelSlot(value: unknown): value is PluginPanelSlot {
  return typeof value === 'string' && isSlot(value);
}

/**
 * The parts of a plugin panel id, or null.
 *
 * Two shapes are accepted, and the second is DELIBERATELY the one that shipped:
 *
 * - `plugin:<id>:<slot>` — the current form;
 * - `plugin:<id>` — a stored blob, an enablement row or an order entry written
 *   before the slot segment existed. It resolves to `rightPanel`, because that
 *   was the only reachable slot when it was written.
 *
 * The plugin id is validated as ONE segment: an empty id, a slash or a third
 * colon is a truncated write or a hand-edited blob, and accepting it would key a
 * width map and a component lookup on an id no registry can report.
 */
export function pluginPanelParts(value: unknown): { pluginId: string; slot: PluginPanelSlot } | null {
  if (typeof value !== 'string' || !value.startsWith(PLUGIN_PANEL_PREFIX)) return null;
  const rest = value.slice(PLUGIN_PANEL_PREFIX.length);
  const pieces = rest.split(':');
  if (pieces.length > 2) return null;
  const [pluginId, slot] = pieces;
  if (!pluginId || pluginId.includes('/')) return null;
  if (slot === undefined) return { pluginId, slot: LEGACY_PLUGIN_SLOT };
  if (!isSlot(slot)) return null;
  return { pluginId, slot };
}

/**
 * The PANEL INSTANCE key a stored value names, or null.
 *
 * A bare `plugin:<id>` normalizes to the `rightPanel` instance, because that was
 * the only reachable slot when such a row was written — the width map, the dock
 * placement and the stored order all read through here, so a row from an older
 * build keeps pointing at the panel it pointed at before.
 */
export function pluginKeyOf(value: unknown): string | null {
  const parts = pluginPanelParts(value);
  return parts ? pluginPanelKey(parts.pluginId, parts.slot) : null;
}

/** Whether a stored value is the retired bare form, and what it resolves to. */
export function migrateLegacyPanelId(value: unknown): { from: string; to: string } | null {
  const parts = pluginPanelParts(value);
  if (!parts || typeof value !== 'string') return null;
  const to = pluginPanelKey(parts.pluginId, parts.slot);
  return value === to ? null : { from: value, to };
}

/** The plugin id inside a panel id, or null. */
export function pluginIdOf(value: unknown): string | null {
  return pluginPanelParts(value)?.pluginId ?? null;
}

/** The slot a panel id names, or null when `value` is not a plugin panel id. */
export function pluginSlotOf(value: unknown): PluginPanelSlot | null {
  return pluginPanelParts(value)?.slot ?? null;
}

/**
 * Whether a stored `layout.activeRightPanel` / width key may be adopted on load.
 *
 * A plugin panel is accepted on the shape of its id alone: the registry is a
 * network read and the slots exist only after a bundle has been imported, so
 * requiring the panel to be present would drop a perfectly valid selection every
 * time the server is slower than the first paint. A panel whose plugin has since
 * been uninstalled renders its own "not installed" notice rather than falling
 * back silently to Files.
 */
export function isPanelId(value: unknown): value is string {
  return (RIGHT_PANEL_TYPES as readonly string[]).includes(value as string) || pluginPanelParts(value) !== null;
}

export type { RightPanelType };
