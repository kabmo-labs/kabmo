/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one reader of the composer's dictation preference, kept live.
 *
 * The composer is a separate subtree from the settings modal and never re-reads
 * the boot-time `appSettings`, so a stored preference read once at render would
 * keep the OLD engine and language until a reload — measured: switching the
 * engine to a hosted one left the mic tooltip saying "This machine (omp)". The
 * modal therefore calls `applyDictationConfig` when the object moves, and this
 * hook is the subscriber.
 *
 * The initial value comes from the primed settings snapshot
 * (`primeKabmoSettings` in `main.tsx`), so a mounted composer already knows the
 * stored engine on its first render.
 */

import { useState } from 'preact/hooks';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { normalizeDictationConfig, type DictationConfig } from '@/shared/lib/dictation/settings';
import type { SettingsState } from '@/shared/types';

/** `app_settings` key holding the preference (inside the `kabmo_settings` blob). */
export const DICTATION_SETTING_KEY = 'dictation' satisfies keyof SettingsState;

/** Window event carrying the normalised config as `detail`. */
export const DICTATION_CHANGED_EVENT = 'omp:dictation-changed';

/** The stored preference, normalised. */
export function currentDictationConfig(appSettings?: Record<string, any>): DictationConfig {
  return normalizeDictationConfig(readKabmoSetting<unknown>(DICTATION_SETTING_KEY, appSettings));
}

/** Announce a new preference. The modal persists; this only re-renders consumers. */
export function applyDictationConfig(config: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(DICTATION_CHANGED_EVENT, { detail: normalizeDictationConfig(config) }),
  );
}

/** The preference the composer should use, kept live across settings edits. */
export function useDictationConfig(): DictationConfig {
  const [config, setConfig] = useState<DictationConfig>(currentDictationConfig);
  useKabmoEvent(DICTATION_CHANGED_EVENT, (event) => {
    setConfig(normalizeDictationConfig((event as CustomEvent<unknown>).detail));
  });
  return config;
}
