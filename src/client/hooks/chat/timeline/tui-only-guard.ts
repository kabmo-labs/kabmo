/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Refuse a slash command omp only implements in its own TUI, in the composer,
 * before it can cost a turn.
 *
 * The guard exists because the RPC prompt path has no slash handling for these
 * names: `session.prompt()` only expands file commands and prompt templates, so
 * `/plan` arrives at the model as literal text and it improvises a whole turn
 * around the string (measured: `/hotkeys` sent the model to read omp's own docs
 * and run bash). The composer already knows the token, so it answers locally
 * with the same notice row shape a real `command_output` frame produces — the
 * user sees why nothing ran, and the model never sees the command.
 *
 * Every send path funnels through here: a fresh send, a steer, a retry of a
 * stored turn, and a queued item's "send now". Queued auto-delivery is covered
 * server-side (`blockedSlashPrompt` in the RPC dispatcher), because it never
 * passes through this module.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import type { ChatMessageData } from '@/shared/types';
import { isTuiOnlySlashCommand, tuiOnlyCommandNotice } from '@/shared/lib/chat/composer/tui-only';

/**
 * Append the refusal as a notice row, the same shape `onCommandOutput` builds.
 * Placed at the tail: no AI placeholder exists yet, so there is nothing to
 * insert before.
 */
export function appendTuiOnlyNotice(
  text: string,
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>,
): void {
  const row: ChatMessageData = {
    id: `tui-only-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'ai',
    content: '',
    notice: tuiOnlyCommandNotice(text),
  };
  setLocalMessages(prev => (prev.some(m => m.notice === row.notice) ? prev : [...prev, row]));
}

/**
 * Whether the draft is a TUI-only command and was answered locally. A true
 * result means the caller must stop — nothing was sent, and the draft is left
 * in the composer so the user can edit or retype it.
 *
 * `harness` scopes the refusal to the agents it is about. The table is omp's
 * own builtin registry, and every other ACP agent publishes ITS OWN command
 * names — measured, claude offers `/clear` and `/status`, both of which are in
 * this table for omp. Applying omp's rule to those chats refused a command the
 * agent implements, so the command never reached it. Undefined keeps the old
 * behaviour (a chat whose harness has not been resolved yet).
 */
export function blockTuiOnlySend(
  text: string,
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>,
  harness?: string | null,
): boolean {
  if (harness && harness !== 'omp-rpc' && harness !== 'omp-acp') return false;
  if (!isTuiOnlySlashCommand(text)) return false;
  appendTuiOnlyNotice(text, setLocalMessages);
  return true;
}
