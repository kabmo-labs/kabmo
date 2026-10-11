/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/command args` for a command a PLUGIN contributed through the
 * `commandPaletteAction` slot is answered by that plugin, not by the model.
 *
 * The popup already offers the token (see `useComposerItems`), but a token can
 * still be typed or pasted straight past it. RPC has no plugin-command
 * expansion, so without this the draft would arrive at the model as literal
 * text and burn a whole turn improvising around it — the same failure the
 * TUI-only guard exists to prevent, for the same reason.
 *
 * The row is looked up in the store, not in a hook: this runs inside the send
 * handler, which is not a render, and the store is the one place that already
 * merges every plugin's rows and resolves duplicate ids.
 *
 * Fire-and-forget, like the btw dispatch: `run` is the plugin's own async work
 * and the send handler must not stall on it.
 */

import type { CommandActionContext, CommandPaletteRegistration } from '@ompchamber/plugin-sdk';
import { listSlotRows, type ListSlotEntry } from '@/client/lib/plugins/list-slots';
import { pluginContext } from '@/client/lib/plugins/context';

/**
 * A leading `/<name>`, with the remainder of the draft as its arguments.
 *
 * Mirrors `slashCommandName`: the name ends at the first space or colon, and the
 * token must START the draft (leading whitespace allowed) — a `/` inside prose
 * is a path, not a command. `/deploy:prod` and `/deploy prod` are therefore the
 * same invocation.
 */
const PLUGIN_COMMAND_RE = /^\s*\/([^\s:]+)(?:[\s:]+([\s\S]*))?$/;

/**
 * Run the plugin command this draft invokes. Returns false when no registered
 * row matches, so the caller keeps its normal send path.
 */
export function dispatchPluginCommand(text: string): boolean {
  const match = PLUGIN_COMMAND_RE.exec(text);
  if (!match) return false;

  const name = match[1].toLowerCase();
  const row = listSlotRows<CommandPaletteRegistration>('commandPaletteAction').find(
    (entry) => entry.registration.command.toLowerCase() === name,
  );
  if (!row) return false;

  const { sessionId, workspacePath } = pluginContext();
  const args = (match[2] ?? '').trim();
  void invokePluginCommand(row, { sessionId, workspacePath, args }, name);
  return true;
}

/**
 * Invoke a row's `run` and REPORT a failure instead of letting it escape.
 *
 * `run` is typed `void | Promise<void>`, so it can throw synchronously as
 * readily as it can reject; an unguarded call would take the send handler down
 * with it — before the input was cleared — and a rejection would surface as a
 * page-level unhandled rejection naming nothing the user did.
 */
async function invokePluginCommand(
  row: ListSlotEntry<CommandPaletteRegistration>,
  context: CommandActionContext,
  name: string,
): Promise<void> {
  try {
    await row.registration.run(context);
  } catch (error: unknown) {
    console.error(`plugin command /${name} failed`, error);
  }
}
