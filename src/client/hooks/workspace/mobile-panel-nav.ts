/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one reader/writer of a PHONE drawer's navigation style.
 *
 * One module for BOTH drawers, keyed by side, because the fact is the same for
 * each and the desktop columns already state it that way
 * (`client/hooks/workspace/panel-nav.ts` carries `left` and `right`). A second
 * copy for the left drawer is how the two would drift about which event they
 * announce or which key they persist under.
 *
 * The drawer is mounted only while it is a screen, so the value has to survive
 * its own unmount — `appSettings` is a boot-time prop and would only show a new
 * style after a reload. The settings modal calls `applyMobilePanelNav` when the
 * value moves, which announces the event; `useMobilePanelNav` is the one
 * subscriber, in the drawer.
 *
 * Deliberately NOT folded into `applyPanelNav(side, style)`: that event carries
 * a desktop SIDE, and a phone change must not repaint a desktop column into a
 * tree it was not asked for.
 */

import { useCallback, useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import type { SettingsState } from '@/shared/types';
import {
  MOBILE_PANEL_NAV_KEYS,
  resolveMobilePanelNav,
  type MobilePanelNav,
  type PanelNavSide,
} from '@/shared/lib/workspace/panel-nav';

/** The key, checked against the settings field it must match to persist at all. */
export const MOBILE_PANEL_NAV_SETTING_KEY: Record<PanelNavSide, keyof SettingsState> = {
  left: MOBILE_PANEL_NAV_KEYS.left satisfies keyof SettingsState,
  right: MOBILE_PANEL_NAV_KEYS.right satisfies keyof SettingsState,
};

/** Window event carrying `{ side, style }` as `detail`. */
export const MOBILE_PANEL_NAV_CHANGED_EVENT = 'omp:mobile-panel-nav-changed';

/** The stored style for one drawer, resolved against what this build can draw. */
export function currentMobilePanelNav(
  side: PanelNavSide,
  appSettings?: Record<string, any>,
): MobilePanelNav {
  return resolveMobilePanelNav(
    readKabmoSetting<unknown>(MOBILE_PANEL_NAV_SETTING_KEY[side], appSettings),
  );
}

/**
 * Announce a new style for one drawer; the persisted copy is the settings
 * modal's own write.
 *
 * The SIDE travels in the detail, so a change to one drawer cannot repaint the
 * other — the same rule `applyPanelNav` follows for the desktop columns, and the
 * reason a single drawer-wide event would be wrong now that both have a style.
 */
export function applyMobilePanelNav(side: PanelNavSide, style: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(MOBILE_PANEL_NAV_CHANGED_EVENT, {
      detail: { side, style: resolveMobilePanelNav(style) },
    }),
  );
}

/** The style one drawer should draw, kept live across settings edits. */
export function useMobilePanelNav(side: PanelNavSide): MobilePanelNav {
  const [style, setStyle] = useState<MobilePanelNav>(() => currentMobilePanelNav(side));
  useKabmoEvent(MOBILE_PANEL_NAV_CHANGED_EVENT, (event) => {
    const detail = (event as CustomEvent<{ side?: unknown; style?: unknown }>).detail;
    // A change addressed to the other drawer is not this drawer's news: an
    // unconditional set would repaint both, and a drawer that re-mounts its
    // tree loses whatever the user had open in it.
    if (detail?.side !== side) return;
    setStyle(resolveMobilePanelNav(detail.style));
  });
  return style;
}

/** A writer the settings modal can hand one drawer's change to. */
export function useMobilePanelNavApply(): (side: PanelNavSide, style: unknown) => void {
  return useCallback((side: PanelNavSide, style: unknown) => applyMobilePanelNav(side, style), []);
}
