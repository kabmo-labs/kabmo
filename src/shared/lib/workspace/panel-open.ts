/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Opening a panel from somewhere that is not its own rail.
 *
 * A plugin's navbar entry can be an ACTION — `app.headerPanel({ opensPanel })`
 * — and so can anything else that names a panel it does not draw. The click
 * cannot resolve the destination itself, because the destination is the USER's
 * choice: the same panel may sit on the left dock, in the right column, in the
 * editor column, or in one of a phone's two drawers. So the event carries the
 * panel INSTANCE key and the layout decides where that key lives right now.
 *
 * The placement rules live in `left-dock.ts` (one source, read by the catalogs,
 * the rails and this module), and this file adds the one thing they cannot
 * answer: which of a PHONE's two drawers can reach a panel. A phone has no
 * rail, so "left" and "right" are screens rather than columns — and a panel
 * placed on the left is drawn by the RIGHT drawer while the rail is off, which
 * is the case a naive `side === 'left' ? leftDrawer : rightDrawer` gets wrong.
 */

import { panelSideOf, type LeftDockState, type PanelSide } from '@/shared/lib/workspace/left-dock';

/**
 * The window event that asks a layout to show a panel.
 *
 * `detail.panelKey` is a panel INSTANCE key (`plugin:<pluginId>:<slot>`) or a
 * built-in view id. A key no layout can resolve is reported by the panel
 * position's own notice, never silently ignored — the same answer the activity
 * bar gives for a panel whose plugin was uninstalled.
 */
export const OPEN_PANEL_EVENT = 'omp:open-panel';

export interface OpenPanelDetail {
  /** The panel instance key to show. */
  panelKey: string;
}

/**
 * Ask the layout to show a panel.
 *
 * The one place the event is dispatched: a navbar readout, a folded menu row and
 * anything else that names a panel must send the SAME shape, or one of them
 * silently stops opening anything.
 */
export function requestOpenPanel(panelKey: string): void {
  if (typeof window === 'undefined' || !panelKey) return;
  window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: { panelKey } }));
}

/** The two screens a phone can put a panel on. */
export type PanelDrawer = 'left' | 'right';

/**
 * The phone drawer that can reach a panel, or null when none can.
 *
 * Three answers, each a different fact:
 *
 * - `left` — the panel is placed on the dock AND the rail is on, so the left
 *   drawer is where its chip is drawn;
 * - `right` — everything else that the right drawer lists. That includes a
 *   panel placed on the left while the rail is OFF: `phoneRightPanels` keeps it
 *   there on purpose, because the left drawer then has no strip and the
 *   placement would otherwise be unreachable;
 * - `null` — an `editor`-slot takeover. The phone has no editor column, so
 *   there is no screen to navigate to and the caller must do nothing rather
 *   than send the user to a drawer that will not show it.
 */
export function phoneDrawerForPanel(panelKey: string, dock: LeftDockState): PanelDrawer | null {
  const side: PanelSide = panelSideOf(panelKey, dock);
  if (side === 'editor') return null;
  if (side === 'left' && dock.enabled) return 'left';
  return 'right';
}
