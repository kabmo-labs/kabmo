/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer's three Enter bindings, resolved from the chamber settings.
 *
 * Settings → Chats → Keybindings persists these through `writeChamberSettings`,
 * so they live in the `omp_chamber_settings` blob — NOT at the top level of
 * `appSettings`, which is the raw `app_settings` rows. Reading them off the top
 * level found nothing and every binding silently fell back to its default: a
 * user who set "send" to Ctrl+Enter still had a bare Enter submit the prompt
 * (measured in the browser: the draft was cleared and a turn rendered).
 *
 * `readChamberSetting` resolves the blob and top-level keys alike, which is what
 * the rest of the composer already uses for `goalDefaultBudget`. The defaults
 * here mirror the settings editor's own, so an unset key reads as the binding
 * the panel shows.
 *
 * Resolution is per keypress (the handler calls this), not per render: the
 * snapshot is updated by the settings writer, so a binding changed while the
 * composer sits untouched still applies to the very next Enter — the same
 * live-read the editor font needs an event to achieve, because here nothing has
 * to re-render to observe it.
 */

import type { SettingsState } from '@/shared/types';
import { readChamberSetting } from '@/shared/lib/settings/client';

export type ComposerKeybinding = SettingsState['keybindingSend'];

export interface ComposerKeybindings {
  /** Plain submit. */
  send: ComposerKeybinding;
  /** Inserts a newline instead of submitting. */
  newLine: ComposerKeybinding;
  /** Submits as a steer into the running turn. */
  steering: ComposerKeybinding;
}

export const DEFAULT_COMPOSER_KEYBINDINGS: ComposerKeybindings = {
  send: 'Enter',
  newLine: 'Shift + Enter',
  steering: 'Ctrl / Cmd + Enter',
};

/** The three bindings, blob key first, then the editor's own defaults. */
export function resolveComposerKeybindings(appSettings?: Record<string, any>): ComposerKeybindings {
  return {
    send: readChamberSetting<ComposerKeybinding>('keybindingSend', appSettings) ?? DEFAULT_COMPOSER_KEYBINDINGS.send,
    newLine: readChamberSetting<ComposerKeybinding>('keybindingNewLine', appSettings) ?? DEFAULT_COMPOSER_KEYBINDINGS.newLine,
    steering: readChamberSetting<ComposerKeybinding>('keybindingSteering', appSettings) ?? DEFAULT_COMPOSER_KEYBINDINGS.steering,
  };
}
