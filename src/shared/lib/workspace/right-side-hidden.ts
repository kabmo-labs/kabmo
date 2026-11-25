/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether the whole right side — the editor column, the right panel and their
 * rail — is put away.
 *
 * GLOBAL, in `app_settings`, unlike the two columns' own switches
 * (`layout.showRightPanel`, `layout.userToggledEditor`): the navbar's toggle
 * answers for the reader's SCREEN, not for the chat drawn on it. Storing it per
 * session meant closing the side in one chat and finding it back in the next
 * one, which made the control look like it forgot the click.
 */

import { readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';

/** `app_settings` key holding the right side's hidden flag. */
export const RIGHT_SIDE_HIDDEN_SETTING_KEY = 'omp_right_side_hidden';

/** The stored preference; absent means the side is on. */
export function readRightSideHidden(): boolean {
  return readKabmoSetting<unknown>(RIGHT_SIDE_HIDDEN_SETTING_KEY) === true;
}

/** Persist one toggle. */
export function saveRightSideHidden(hidden: boolean): void {
  writeSetting(RIGHT_SIDE_HIDDEN_SETTING_KEY, hidden);
}
