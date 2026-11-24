/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether the Usage panel drops the providers that report no quota. ON by
 * default: a card whose whole body is "No quota source for this provider" is
 * noise, and the header toggle (or the empty state's own link) is the way back.
 *
 * GLOBAL, like the sidebar's width and the model picker's folds: which
 * providers a reader cares about is a fact about them, not about the chat they
 * have open. Stored per session it would reset on every new chat — the failure
 * `shared/lib/models/picker-collapsed.ts` documents for the same reason.
 *
 * `app_settings` is the single source of truth (there is no localStorage) and
 * the key is top-level, so a write merges beside the other preferences instead
 * of republishing the `kabmo_settings` blob. `readKabmoSetting` answers from
 * the snapshot `main.tsx` primes at boot, so the panel's first render already
 * draws the stored choice.
 */

import { useCallback, useState } from 'preact/hooks';
import { readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';

/** `app_settings` key holding the choice. */
export const HIDE_EMPTY_PROVIDERS_SETTING_KEY = 'usageHideEmptyProviders';

/**
 * The stored choice: hiding unless the reader turned it off. Only the literal
 * `false` shows the empty rows — an absent key is a fresh install and a
 * hand-written scalar outside JSON (which comes back as text) must not
 * silently flip the panel's default.
 */
export function currentHideEmptyProviders(appSettings?: Record<string, any>): boolean {
  return readKabmoSetting<unknown>(HIDE_EMPTY_PROVIDERS_SETTING_KEY, appSettings) !== false;
}

/** The stored choice plus its writer. The panel is the only reader. */
export function useHideEmptyProviders(): [boolean, (next: boolean) => void] {
  const [hide, setHide] = useState<boolean>(() => currentHideEmptyProviders());

  const setValue = useCallback((next: boolean) => {
    setHide(next);
    writeSetting(HIDE_EMPTY_PROVIDERS_SETTING_KEY, next);
  }, []);

  return [hide, setValue];
}
