/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The LEFT dock: which view fills it, and which panels may live there.
 *
 * The left column used to be the session sidebar and nothing else. It is now a
 * DOCK with a view on it, exactly as the right column is — the sessions list is
 * the built-in view, and a plugin panel can be placed beside it by the user.
 *
 * Three decisions are encoded here rather than at a call site:
 *
 * - **The dock is OPTIONAL and OFF by default.** Its activity bar is a setting,
 *   and while it is off the dock shows only its active view with no rail and no
 *   second width to reserve. That is what makes the feature free for the many
 *   users who never place a panel on the left: nothing renders, nothing is
 *   measured, and no extra panel competes with the chat for the group's budget.
 * - **Placement is the USER's, never the plugin's.** A plugin keeps registering
 *   `app.rightPanel(...)`; where it is drawn is a per-install preference. That
 *   is what keeps ONE id (`plugin:<id>`) meaning one panel — the id the server
 *   gates the bundle with, the enablement set stores, the width map keys and the
 *   stored order ranks. A second slot name would have split all four.
 * - **The sessions view cannot be moved.** It is the reason the left column
 *   exists, and moving it would leave a chat with no way to reach another one.
 *
 * Stored GLOBAL (`app_settings.omp_left_panels`), like the right panel's order:
 * the dock lists the same panels in every session, so a per-session placement
 * would move the user's own arrangement when they picked another chat.
 */

import { readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';
import { pluginKeyOf } from '@/shared/lib/workspace/panel-ids';

/** `app_settings` key holding the dock's own state. */
export const LEFT_DOCK_SETTING_KEY = 'omp_left_panels';

/** The built-in view that owns the left column unless the user places another. */
export const SESSIONS_VIEW_ID = 'sessions';

/** Which column a panel is drawn in. */
export type PanelSide = 'left' | 'right';

/** The dock's stored state, validated. */
export interface LeftDockState {
  /** Whether the dock's activity bar is drawn at all. OFF unless set. */
  enabled: boolean;
  /** Panel ids the user placed on the left, in bar order. */
  panels: string[];
}

const EMPTY: LeftDockState = { enabled: false, panels: [] };

/**
 * The ids that may live on the left.
 *
 * The sessions view is the dock's own; anything else must be a plugin panel —
 * a bare built-in id (`git`, `files`) names a view whose width slot, floor and
 * workspace gate were all declared for the RIGHT column, and moving it is a
 * second feature rather than a placement.
 */
export function isLeftDockPanelId(value: unknown): value is string {
  if (value === SESSIONS_VIEW_ID) return true;
  return pluginKeyOf(value) !== null;
}

/**
 * The stored state, validated.
 *
 * A row this build does not recognise is DROPPED rather than kept: unlike the
 * right panel's order, this list is also the enablement of the dock's buttons,
 * so a stale id would draw a button that resolves to nothing.
 */
export function readLeftDock(): LeftDockState {
  const stored = readKabmoSetting<unknown>(LEFT_DOCK_SETTING_KEY);
  if (typeof stored !== 'object' || stored === null) return EMPTY;
  const raw = stored as { enabled?: unknown; panels?: unknown };
  const panels: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.panels)) {
    for (const value of raw.panels) {
      if (!isLeftDockPanelId(value) || value === SESSIONS_VIEW_ID || seen.has(value)) continue;
      seen.add(value);
      panels.push(value);
    }
  }
  return { enabled: raw.enabled === true, panels };
}

/** Persist one change to the dock, keeping the other half. */
export function writeLeftDock(patch: Partial<LeftDockState>): LeftDockState {
  const current = readLeftDock();
  const next: LeftDockState = {
    enabled: patch.enabled ?? current.enabled,
    panels: patch.panels ? [...new Set(patch.panels.filter(isLeftDockPanelId))] : current.panels,
  };
  writeSetting(LEFT_DOCK_SETTING_KEY, next);
  return next;
}

/**
 * Place a plugin panel on the left, or take it back to the right.
 *
 * **Placing a panel turns the rail ON.** The rail exists to reach the panels on
 * it, so a successful placement with the rail still off is a move with no
 * button, no view and nothing on screen to undo it — the settings row would be
 * the only control, which is the state a user reads as broken. The switch is
 * written in the SAME state as the placement, so no reader can observe one
 * without the other.
 *
 * Moving a panel back does NOT turn the rail off: that switch is the user's, and
 * the dock may still be worth showing without this panel on it.
 */
export function setPanelSide(panelId: string, side: PanelSide): LeftDockState {
  if (!isLeftDockPanelId(panelId) || panelId === SESSIONS_VIEW_ID) return readLeftDock();
  const current = readLeftDock();
  const placed = current.panels.includes(panelId);
  if (side === 'left') {
    if (placed && current.enabled) return current;
    const panels = placed ? current.panels : [...current.panels, panelId];
    return writeLeftDock({ enabled: true, panels });
  }
  if (!placed) return current;
  return writeLeftDock({ panels: current.panels.filter((id) => id !== panelId) });
}

/**
 * Which side a panel is drawn on.
 *
 * The sessions view is left by construction; a plugin panel is left only while
 * the user has placed it there; a built-in view is always right.
 */
export function panelSideOf(panelId: string, dock: LeftDockState = readLeftDock()): PanelSide {
  if (panelId === SESSIONS_VIEW_ID) return 'left';
  return dock.panels.includes(panelId) ? 'left' : 'right';
}

/**
 * The left column's views in bar order: the dock's own view, then every placed
 * plugin in the order they were placed.
 */
export function leftPanelIds(dock: LeftDockState = readLeftDock()): string[] {
  return [SESSIONS_VIEW_ID, ...dock.panels];
}
