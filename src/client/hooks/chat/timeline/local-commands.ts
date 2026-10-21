/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Commands Kabmo answers itself, checked before anything can reach the model.
 *
 * Two of them, and both MUST run ahead of the TUI-only guard:
 *
 *   - `/btw [question]` is the side-question panel's entry point. omp implements
 *     `/btw` in its TUI only, so the guard would refuse the very command Kabmo
 *     answers — a bare `/btw` just opens the panel's history.
 *   - a command a PLUGIN contributed through `commandPaletteAction` is local
 *     work the popup advertised, so it must never arrive as literal text (RPC
 *     has no expansion for it, and omp would improvise a turn around the
 *     string). A plugin may legitimately claim a name omp implements only in its
 *     TUI, and refusing the row the popup just offered would be the composer
 *     contradicting itself.
 */

import type { Attachment } from '@/shared/types/chat';
import { dispatchBtwCommand } from '@/client/hooks/chat/btw/intercept';
import { dispatchPluginCommand } from '@/client/hooks/chat/timeline/plugin-commands';

/** True when the text was answered locally — the caller clears the composer and returns. */
export function dispatchLocalCommand(text: string, attachments: Attachment[]): boolean {
  return dispatchBtwCommand(text, attachments) || dispatchPluginCommand(text);
}
