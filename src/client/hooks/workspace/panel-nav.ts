/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one reader/writer of the desktop panel navigation style, per column.
 *
 * A style picks a COMPONENT TREE (`LeftColumn`/`RightColumn`'s switch between
 * the rail and the tab strip), so something in JavaScript must re-render when
 * it changes — `appSettings` is a boot-time prop and would only show a new
 * style after a reload. The settings modal calls `applyPanelNav` when a value
 * moves, which announces `omp:panel-nav-changed` with the SIDE and the resolved
 * style; `usePanelNav(side)` is the single subscriber per column.
 *
 * Two independent values, because the columns answer different questions. The
 * event carries the side so a change on the left cannot repaint the right into a
 * tree it was not asked for.
 *
 * The initial value comes from the primed settings snapshot
 * (`primeKabmoSettings` in `main.tsx`), so a mounted column draws the stored
 * style on its first render — no flash of the other chrome.
 */

import { useCallback, useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import type { SettingsState } from '@/shared/types';
import {
  PANEL_NAV_SETTING_KEYS,
  isPanelNavSide,
  resolvePanelNav,
  type PanelNavSide,
  type PanelNavStyle,
} from '@/shared/lib/workspace/panel-nav';

/**
 * `app_settings` keys holding each column's style (in the `kabmo_settings`
 * blob).
 *
 * `satisfies keyof SettingsState` because the key and the field name must be the
 * same string for persistence to work at all — renaming a field without this
 * line would leave the setting silently unsaved.
 */
export const PANEL_NAV_SETTING_KEY: Record<PanelNavSide, keyof SettingsState> = {
  left: PANEL_NAV_SETTING_KEYS.left satisfies keyof SettingsState,
  right: PANEL_NAV_SETTING_KEYS.right satisfies keyof SettingsState,
};

/** Window event carrying `{ side, style }` as `detail`. */
export const PANEL_NAV_CHANGED_EVENT = 'omp:panel-nav-changed';

/** The stored style for one column, resolved against what this build can draw. */
export function currentPanelNav(
  side: PanelNavSide,
  appSettings?: Record<string, any>,
): PanelNavStyle {
  return resolvePanelNav(readKabmoSetting<unknown>(PANEL_NAV_SETTING_KEY[side], appSettings));
}

/**
 * Announce a new style for one column. Called by the settings modal when the
 * value changes — the persisted copy is written by the modal's own
 * `writeKabmoSettings`, so this function only has to make the mounted column
 * re-render.
 */
export function applyPanelNav(side: PanelNavSide, style: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PANEL_NAV_CHANGED_EVENT, {
      detail: { side, style: resolvePanelNav(style) },
    }),
  );
}

/** The style one column should draw, kept live across settings edits. */
export function usePanelNav(side: PanelNavSide): PanelNavStyle {
  const [style, setStyle] = useState<PanelNavStyle>(() => currentPanelNav(side));

  useKabmoEvent(PANEL_NAV_CHANGED_EVENT, (event) => {
    const detail = (event as CustomEvent<{ side?: unknown; style?: unknown }>).detail;
    // A change addressed to the other column is not this column's news: an
    // unconditional set would repaint both, and a column that re-mounts its
    // tree loses whatever the user had open in it.
    if (!isPanelNavSide(detail?.side) || detail.side !== side) return;
    setStyle(resolvePanelNav(detail.style));
  });

  return style;
}

/** A writer the settings modal can hand a single column's change to. */
export function usePanelNavApply(): (side: PanelNavSide, style: unknown) => void {
  return useCallback((side: PanelNavSide, style: unknown) => applyPanelNav(side, style), []);
}
