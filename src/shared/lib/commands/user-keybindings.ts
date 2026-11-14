/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The user's keybinding overrides, stored in the `kabmo_settings` blob.
 *
 * The shape is a map of command id to chord text, with `null` meaning
 * "deliberately unbound". A map rather than a list of rules because the user is
 * editing ONE command at a time: a list would need a merge rule for duplicates,
 * and the merge rule would be a second implementation of the keymap.
 *
 * An id this build no longer ships is KEPT. Dropping it would silently lose a
 * preference on a downgrade, and the settings page can show it as unknown.
 */

import { readKabmoSetting, writeKabmoSettings } from '@/shared/lib/settings/client';
import { parseChord } from '@/shared/lib/commands/chord';
import type { UserKeybindings } from '@/shared/lib/commands/types';

export const KEYBINDINGS_SETTING_KEY = 'keybindings';

export interface ParsedUserKeybindings {
  bindings: UserKeybindings;
  /** Entries that were dropped, with the reason, so the UI can report them. */
  invalid: { id: string; reason: string }[];
}

/** Validate a stored map. A malformed chord is dropped and reported, never
 *  silently applied as something else. */
export function parseUserKeybindings(raw: unknown): ParsedUserKeybindings {
  const bindings: Record<string, string | null> = {};
  const invalid: { id: string; reason: string }[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { bindings, invalid };
  }
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null) {
      bindings[id] = null;
      continue;
    }
    if (typeof value !== 'string') {
      invalid.push({ id, reason: 'not a chord' });
      continue;
    }
    try {
      parseChord(value);
      bindings[id] = value;
    } catch (error) {
      invalid.push({ id, reason: error instanceof Error ? error.message : 'invalid chord' });
    }
  }
  return { bindings, invalid };
}

export function readUserKeybindings(appSettings?: Record<string, unknown>): UserKeybindings {
  return parseUserKeybindings(readKabmoSetting<unknown>(KEYBINDINGS_SETTING_KEY, appSettings)).bindings;
}

/** Persist the whole map. The caller owns the merge with the previous value. */
export function writeUserKeybindings(next: UserKeybindings): void {
  writeKabmoSettings({ [KEYBINDINGS_SETTING_KEY]: next });
}
