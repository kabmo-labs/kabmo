/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one reader/writer of the transcript's tool-render style.
 *
 * Unlike the chat column's width (an attribute CSS reads), the style picks a
 * Preact renderer, so something in JavaScript must re-render when it changes.
 * The settings modal therefore calls `applyToolRenderMode` when the value
 * moves, which announces `omp:tool-render-changed`; `useToolRenderMode` is the
 * single subscriber, and `ToolCallingSection` is the only consumer.
 *
 * The initial value comes from the primed settings snapshot
 * (`primeKabmoSettings` in `main.tsx`), so a mounted timeline draws the stored
 * style on its first render — no flash of the default.
 */

import { useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import type { SettingsState } from '@/shared/types';
import {
  resolveToolRenderMode,
  type ToolRenderMode,
} from '@/shared/lib/chat/timeline/tool-render-mode';

/**
 * `app_settings` key holding the style (in the `kabmo_settings` blob).
 *
 * `satisfies keyof SettingsState` because the key and the field name must be
 * the same string for persistence to work at all — renaming the field without
 * this line would leave the setting silently unsaved.
 */
export const TOOL_RENDER_SETTING_KEY = 'toolRenderStyle' satisfies keyof SettingsState;

/** Window event carrying the resolved mode as `detail`. */
export const TOOL_RENDER_CHANGED_EVENT = 'omp:tool-render-changed';

/** The stored style, resolved against what this build can draw. */
export function currentToolRenderMode(appSettings?: Record<string, any>): ToolRenderMode {
  return resolveToolRenderMode(readKabmoSetting<unknown>(TOOL_RENDER_SETTING_KEY, appSettings));
}

/**
 * Announce a new style. Called by the settings modal when the value changes —
 * the persisted copy is written by the modal's own `writeKabmoSettings`, so
 * this function only has to make the open timeline re-render.
 */
export function applyToolRenderMode(mode: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(TOOL_RENDER_CHANGED_EVENT, { detail: resolveToolRenderMode(mode) }),
  );
}

/** The style the transcript should draw, kept live across settings edits. */
export function useToolRenderMode(): ToolRenderMode {
  const [mode, setMode] = useState<ToolRenderMode>(() => currentToolRenderMode());
  useKabmoEvent(TOOL_RENDER_CHANGED_EVENT, (event) => {
    setMode(resolveToolRenderMode((event as CustomEvent<unknown>).detail));
  });
  return mode;
}
