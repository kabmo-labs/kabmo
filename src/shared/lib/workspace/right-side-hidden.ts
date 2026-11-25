/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether the whole right side — the editor column, the right panel and their
 * rail — is put away, and how long that answer is remembered.
 *
 * The SCOPE is the user's choice (`session` by default): closing the side is
 * about one chat, as every other layout choice is, but a reader who works the
 * same way in every chat can have it apply to all of them. Two slots therefore
 * exist:
 *
 * - `session` (default) — `layout.rightSideHidden` in `session_ui_state`, so
 *   switching chats brings back the side each chat was left with.
 * - `global` — `app_settings.omp_right_side_hidden`, so a close is the reader's
 *   screen rather than the chat's.
 *
 * Every toggle writes BOTH slots. That is what makes switching this setting
 * harmless: the scope only decides which slot is read, never which one has an
 * opinion, so a user who changes the setting sees the side they already chose
 * rather than a stale value from the other slot.
 */

import { readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';

export type RightSideHiddenScope = 'session' | 'global';

/** `kabmo_settings` key holding the scope choice. */
export const RIGHT_SIDE_HIDDEN_SCOPE_KEY = 'rightSideHiddenScope' as const;

/** Per session, so an upgrade rearranges nothing and matches the columns. */
export const DEFAULT_RIGHT_SIDE_HIDDEN_SCOPE: RightSideHiddenScope = 'session';

/** `app_settings` key holding the side's state under the global scope. */
export const RIGHT_SIDE_HIDDEN_SETTING_KEY = 'omp_right_side_hidden';

/** A stored value, resolved to a scope this build can honour. */
export function resolveRightSideHiddenScope(value: unknown): RightSideHiddenScope {
  return value === 'global' ? 'global' : DEFAULT_RIGHT_SIDE_HIDDEN_SCOPE;
}

/** The stored scope; absent means the session default. */
export function currentRightSideHiddenScope(appSettings?: Record<string, any>): RightSideHiddenScope {
  return resolveRightSideHiddenScope(readKabmoSetting<unknown>(RIGHT_SIDE_HIDDEN_SCOPE_KEY, appSettings));
}

/** The stored global preference; absent means the side is on. */
export function readRightSideHidden(): boolean {
  return readKabmoSetting<unknown>(RIGHT_SIDE_HIDDEN_SETTING_KEY) === true;
}

/** Persist one toggle into the global slot. */
export function saveRightSideHidden(hidden: boolean): void {
  writeSetting(RIGHT_SIDE_HIDDEN_SETTING_KEY, hidden);
}
