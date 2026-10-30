/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one reader/writer of the session sidebar's style.
 *
 * A style picks a Preact component tree (`SessionsView`'s switch), so something
 * in JavaScript must re-render when it changes — `appSettings` is a boot-time
 * prop and would only show a new style after a reload. The settings modal calls
 * `applySidebarStyle` when the value moves, which announces
 * `omp:sidebar-style-changed`; `useSidebarStyle` is the single subscriber and
 * the two sidebars (desktop dock, phone drawer) are its only consumers.
 *
 * The initial value comes from the primed settings snapshot
 * (`primeKabmoSettings` in `main.tsx`), so a mounted sidebar draws the stored
 * style on its first render — no flash of the other variant.
 */

import { useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import type { SettingsState } from '@/shared/types';
import {
  resolveSidebarStyle,
  type SidebarStyle,
} from '@/shared/lib/workspace/sidebar-style';

/**
 * `app_settings` key holding the style (in the `kabmo_settings` blob).
 *
 * `satisfies keyof SettingsState` because the key and the field name must be
 * the same string for persistence to work at all — renaming the field without
 * this line would leave the setting silently unsaved.
 */
export const SIDEBAR_STYLE_SETTING_KEY = 'sidebarStyle' satisfies keyof SettingsState;

/** Window event carrying the resolved style as `detail`. */
export const SIDEBAR_STYLE_CHANGED_EVENT = 'omp:sidebar-style-changed';

/** The stored style, resolved against what this build can draw. */
export function currentSidebarStyle(appSettings?: Record<string, any>): SidebarStyle {
  return resolveSidebarStyle(readKabmoSetting<unknown>(SIDEBAR_STYLE_SETTING_KEY, appSettings));
}

/**
 * Announce a new style. Called by the settings modal when the value changes —
 * the persisted copy is written by the modal's own `writeKabmoSettings`, so
 * this function only has to make the mounted sidebar re-render.
 */
export function applySidebarStyle(style: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SIDEBAR_STYLE_CHANGED_EVENT, { detail: resolveSidebarStyle(style) }),
  );
}

/** The style the sidebar should draw, kept live across settings edits. */
export function useSidebarStyle(): SidebarStyle {
  const [style, setStyle] = useState<SidebarStyle>(() => currentSidebarStyle());
  useKabmoEvent(SIDEBAR_STYLE_CHANGED_EVENT, (event) => {
    setStyle(resolveSidebarStyle((event as CustomEvent<unknown>).detail));
  });
  return style;
}
