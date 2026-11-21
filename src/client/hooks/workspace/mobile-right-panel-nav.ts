/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one reader/writer of the PHONE's right-drawer navigation style.
 *
 * The drawer is mounted only while it is a screen, so the value has to survive
 * its own unmount — `appSettings` is a boot-time prop and would only show a new
 * style after a reload. The settings modal calls `applyMobileRightPanelNav` when
 * the value moves, which announces the event; `useMobileRightPanelNav` is the
 * one subscriber, in the drawer.
 *
 * Deliberately NOT folded into `applyPanelNav(side, style)`: that event carries
 * a desktop SIDE, and a phone change must not repaint a desktop column into a
 * tree it was not asked for.
 */

import { useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import type { SettingsState } from '@/shared/types';
import {
  MOBILE_RIGHT_PANEL_NAV_KEY,
  resolveMobileRightPanelNav,
  type MobileRightPanelNav,
} from '@/shared/lib/workspace/panel-nav';

/** The key, checked against the settings field it must match to persist at all. */
export const MOBILE_RIGHT_PANEL_NAV_SETTING_KEY =
  MOBILE_RIGHT_PANEL_NAV_KEY satisfies keyof SettingsState;

/** Window event carrying the resolved style as `detail`. */
export const MOBILE_RIGHT_PANEL_NAV_CHANGED_EVENT = 'omp:mobile-right-panel-nav-changed';

/** The stored style, resolved against what this build can draw. */
export function currentMobileRightPanelNav(
  appSettings?: Record<string, any>,
): MobileRightPanelNav {
  return resolveMobileRightPanelNav(
    readKabmoSetting<unknown>(MOBILE_RIGHT_PANEL_NAV_SETTING_KEY, appSettings),
  );
}

/** Announce a change; the persisted copy is the settings modal's own write. */
export function applyMobileRightPanelNav(style: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(MOBILE_RIGHT_PANEL_NAV_CHANGED_EVENT, {
      detail: resolveMobileRightPanelNav(style),
    }),
  );
}

/** The style the drawer should draw, kept live across settings edits. */
export function useMobileRightPanelNav(): MobileRightPanelNav {
  const [style, setStyle] = useState<MobileRightPanelNav>(() => currentMobileRightPanelNav());
  useKabmoEvent(MOBILE_RIGHT_PANEL_NAV_CHANGED_EVENT, (event) => {
    setStyle(resolveMobileRightPanelNav((event as CustomEvent<unknown>).detail));
  });
  return style;
}
