/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one reader/writer of the transcript's "N files changed" list.
 *
 * The list is a Preact subtree, so something in JavaScript must re-render when
 * the setting moves. The settings modal calls {@link applyShowChangedFiles},
 * which announces {@link CHANGED_FILES_CHANGED_EVENT}; {@link useShowChangedFiles}
 * is the single subscriber, and the timeline is the only consumer.
 *
 * The initial value comes from the primed settings snapshot
 * (`primeKabmoSettings` in `main.tsx`), so a mounted timeline draws the stored
 * choice on its first render — no flash of the default.
 */

import { useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import type { SettingsState } from '@/shared/types';

/**
 * `app_settings` key holding the choice (in the `kabmo_settings` blob).
 *
 * `satisfies keyof SettingsState` because the key and the field name must be
 * the same string for persistence to work at all — renaming the field without
 * this line would leave the setting silently unsaved.
 */
export const CHANGED_FILES_SETTING_KEY = 'showChangedFiles' satisfies keyof SettingsState;

/** Window event carrying the resolved boolean as `detail`. */
export const CHANGED_FILES_CHANGED_EVENT = 'omp:changed-files-changed';

/** The stored choice; only the literal `false` turns the list off. */
export function currentShowChangedFiles(appSettings?: Record<string, any>): boolean {
  return readKabmoSetting<unknown>(CHANGED_FILES_SETTING_KEY, appSettings) !== false;
}

/**
 * Announce a new choice. Called by the settings modal when the value changes —
 * the persisted copy is written by the modal's own `writeKabmoSettings`, so
 * this function only has to make the open timeline re-render.
 */
export function applyShowChangedFiles(value: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(CHANGED_FILES_CHANGED_EVENT, { detail: value !== false }),
  );
}

/** Whether the transcript should draw the list, kept live across settings edits. */
export function useShowChangedFiles(): boolean {
  const [show, setShow] = useState<boolean>(() => currentShowChangedFiles());
  useKabmoEvent(CHANGED_FILES_CHANGED_EVENT, (event) => {
    setShow((event as CustomEvent<unknown>).detail !== false);
  });
  return show;
}
