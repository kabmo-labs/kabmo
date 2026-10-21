/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The LEFT dock's width, remembered PER VIEW.
 *
 * The left column used to hold one view, so one number was enough and it lives
 * in `sidebar-width.ts` (`omp_sidebar_width`). The column is a dock now, and a
 * plugin panel placed on it wants its own width: a session list reads at 280px
 * and a table does not, and a column that snapped to the list's width the moment
 * the user switched views would be a column with one width that is wrong for
 * every second view.
 *
 * GLOBAL, like the sidebar's own width and the right panel's order — the dock
 * lists the same views in every session, so a width stored per session would
 * move the layout when the user picked a different chat.
 *
 * The sessions view keeps reading `sidebar-width.ts` as its fallback, so an
 * install that has been dragging the sidebar for a year opens at the width it
 * was left at rather than at this module's default.
 */

import { readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';
import {
  DEFAULT_LEFT_PANEL_WIDTH,
  MAX_LEFT_PANEL_WIDTH,
  MIN_LEFT_PANEL_WIDTH,
  resolveSidebarWidth,
} from '@/shared/lib/workspace/sidebar-width';

/** `app_settings` key holding the dock's per-view widths, in pixels. */
export const LEFT_DOCK_WIDTHS_SETTING_KEY = 'omp_left_dock_widths';

/**
 * Floor for a view that is not the session list.
 *
 * A plugin panel declares its own floor (320, `MIN_PLUGIN_PANEL_WIDTH`), and a
 * column narrower than that clips the view it is showing. The list reads fine
 * lower, which is why the two differ.
 */
export const MIN_LEFT_DOCK_PLUGIN_WIDTH = 320;

function clamped(viewId: string, px: number): number {
  const floor = viewId === SESSIONS_VIEW_ID ? MIN_LEFT_PANEL_WIDTH : MIN_LEFT_DOCK_PLUGIN_WIDTH;
  return Math.min(MAX_LEFT_PANEL_WIDTH, Math.max(floor, Math.round(px)));
}

function readMap(): Record<string, number> {
  const stored = readKabmoSetting<unknown>(LEFT_DOCK_WIDTHS_SETTING_KEY);
  if (typeof stored !== 'object' || stored === null) return {};
  const out: Record<string, number> = {};
  for (const [view, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[view] = value;
  }
  return out;
}

/**
 * The width this view opens at.
 *
 * A remembered width wins; otherwise the session list falls back to the width
 * `sidebar-width.ts` has always resolved (setting, then the retired global blob,
 * then the session slot), and a plugin view opens at the dock's plugin default.
 */
export function resolveLeftDockWidth(viewId: string): number {
  const stored = readMap()[viewId];
  if (stored !== undefined) return clamped(viewId, stored);
  if (viewId === SESSIONS_VIEW_ID) return resolveSidebarWidth();
  return clamped(viewId, DEFAULT_LEFT_PANEL_WIDTH);
}

/** Persist a dragged width for one view. */
export function saveLeftDockWidth(viewId: string, px: number): void {
  writeSetting(LEFT_DOCK_WIDTHS_SETTING_KEY, { ...readMap(), [viewId]: clamped(viewId, px) });
}
