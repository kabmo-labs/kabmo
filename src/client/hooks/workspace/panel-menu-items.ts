/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The activity bar's right-click menu: every panel the rail can offer.
 *
 * A switched-off panel is NOT in the catalog (the catalog is what the bar
 * draws), so reading the menu off the catalog alone would make a hidden view
 * unreachable — the one thing the menu exists to prevent. The built-ins are a
 * static list, so they are always listed; a plugin is listed while it is
 * INSTALLED, read from `plugins` rather than from `panels`, because `panels`
 * holds only the enabled ones and a disabled plugin would lose its row.
 *
 * The list is per SIDE, and a built-in belongs to the rail its PLACEMENT names:
 * both rails can draw built-in views, so listing all eleven on both would be
 * two menus for one switch. A built-in moved to the left is therefore still
 * switchable from the left rail, and the right rail stops offering it.
 *
 * It lives in a hook of its own because the bar itself is at the file ceiling
 * and this is a self-contained read: the rail draws a catalog, the menu draws
 * the catalog's ABSENCE.
 */

import { BUILTIN_PANELS } from '@/client/components/workspace/panels/builtin';
import { usePanelRegistry } from '@/client/hooks/workspace/panel-registry';
import { useLeftDock } from '@/client/hooks/workspace/left-dock';
import { pluginEnablementKey } from '@/shared/lib/workspace/panel-ids';
import type { PanelCatalogSide } from '@/client/components/workspace/plugin-panel/catalog';
import { SESSIONS_VIEW_ID, isLeftDockPanelId, panelSideOf } from '@/shared/lib/workspace/left-dock';
import type { VisibilityItem } from '@/client/components/layout/VisibilityMenu';

export function useAllPanelItems(side: PanelCatalogSide): VisibilityItem[] {
  const { plugins } = usePanelRegistry();
  const dock = useLeftDock();
  const items: VisibilityItem[] = [];
  if (side !== 'right') {
    // The session list is the dock's own view and cannot be switched off: it is
    // the only way back to a conversation.
    items.push({ id: SESSIONS_VIEW_ID, title: 'Sessions', removable: false });
  }
  for (const panel of BUILTIN_PANELS) {
    const placedLeft = panelSideOf(panel.id, dock) === 'left';
    if (side === 'left' ? placedLeft : side === 'right' ? !placedLeft : true) {
      items.push({ id: panel.id, title: panel.title, removable: true });
    }
  }
  for (const plugin of plugins) {
    const id = pluginEnablementKey(plugin.pluginId);
    // A plugin is offered on both rails: its placement decides which one draws
    // it, and the switch is the same switch on either.
    if (side === 'left' && !isLeftDockPanelId(id)) continue;
    items.push({ id, title: plugin.name, removable: true });
  }
  return items;
}
