/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Slash commands oh-my-pi implements only for its own TUI.
 *
 * omp's registry carries a `handle` (text/ACP mode) for 42 of its 82 builtins
 * and `handleTui` alone for the other 40. `executeAcpBuiltinSlashCommand`
 * requires `handle`, and `buildAvailableSlashCommands` skips entries without
 * one — which is why none of these names appear in the composer popup.
 *
 * The popup is not the whole surface: a name can still be typed, pasted from
 * the docs, or arrive through the follow-up queue. RPC forwards such a prompt
 * to `session.prompt()` verbatim, where the only slash handling left is file
 * commands and prompt templates — so `/plan` reaches the MODEL as literal text
 * and it improvises a turn around it. Measured on omp 18.3.5: `/hotkeys`
 * started a run whose transcript opened with the raw string, the model read
 * `omp://slash-command-internals.md` and ran bash and grep to work out what it
 * meant. `/clear` cleared nothing, `/new` opened nothing, `/login` logged in
 * nothing. The TUI answers all of these instantly and locally.
 *
 * The table is data extracted from the installed omp's own registry, so a name
 * omp moves to text mode stops being guarded by deleting its row. It is
 * deliberately keyed on NAMES ONLY: the guard must not depend on the version of
 * the running child, because a Kabmo talking to an older omp would otherwise
 * refuse a command that build actually implements.
 *
 * `plan` and `goal` are absent because Kabmo now owns them: the composer's
 * mode toggles send `/kabmo-mode …` to a Kabmo-owned extension inside the
 * child, which reaches the live `AgentSession` the TUI drives. A typed `/plan`
 * or `/goal` is therefore answered by that same extension rather than refused —
 * the extension registers the real command names as aliases, so the docs' syntax
 * works too. `plan-review` and `guided-goal` stay listed: neither has a
 * counterpart the extension can honour from a prompt.
 *
 * `btw` is listed because omp's entry is TUI-only — Kabmo's own `/btw`
 * is intercepted before this predicate is consulted (see `dispatchBtwCommand`),
 * so the two never conflict.
 */

import { KABMO_COMMANDS } from '@/shared/lib/chat/composer/trigger';

/**
 * Commands Kabmo answers itself, derived from the one list that defines
 * them. They are in omp's TUI-only set (omp implements `/btw` with `handleTui`
 * only) but they are NOT unavailable here — the composer intercepts them before
 * any guard runs.
 *
 * Derived rather than restated: a second hand-kept list is exactly what drifts,
 * and a name that moved into `KABMO_COMMANDS` without a matching row here
 * would be refused by the very guard that exists to protect it.
 */
export const KABMO_OWNED_SLASH_COMMANDS: Record<string, true> = Object.fromEntries(
  KABMO_COMMANDS.map((command) => [command.name.toLowerCase(), true as const]),
);

/** Every TUI-only builtin name and alias, lowercased. */
export const TUI_ONLY_SLASH_COMMANDS: Record<string, true> = {
  settings: true,
  setup: true,
  providers: true,
  'plan-review': true,
  vibe: true,
  'guided-goal': true,
  loop: true,
  queue: true,
  collab: true,
  join: true,
  leave: true,
  copy: true,
  open: true,
  hotkeys: true,
  extensions: true,
  status: true,
  agents: true,
  git: true,
  hub: true,
  branch: true,
  rewind: true,
  fork: true,
  tree: true,
  login: true,
  logout: true,
  new: true,
  clear: true,
  delete: true,
  resume: true,
  btw: true,
  tan: true,
  omfg: true,
  cleanse: true,
  debug: true,
  exit: true,
  restart: true,
  skills: true,
  live: true,
  record: true,
  pause: true,
  quit: true,
  q: true,
};

/** The command token of a draft, lowercased, or null when it is not a slash
 *  invocation. Mirrors omp's own parse: the name ends at the first space or
 *  colon, and the token must START the prompt (leading whitespace allowed) —
 *  a `/` inside prose is a path, not a command. */
export function slashCommandName(text: string): string | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const rest = trimmed.slice(1);
  const end = rest.search(/[\s:]/);
  const name = end === -1 ? rest : rest.slice(0, end);
  return name ? name.toLowerCase() : null;
}

/**
 * Whether a draft invokes a command Kabmo cannot run, because omp only
 * implements it in its TUI. Such a prompt must be refused locally — forwarding
 * it makes the model answer a command it never received.
 *
 * A command Kabmo owns is excluded: `/btw` is TUI-only in omp, but the
 * Kabmo answers it with the side-question panel, so refusing it here would
 * break a working feature. The client intercepts those before consulting this
 * predicate; the exclusion is what keeps the SERVER-side guard (which sees only
 * the text, e.g. on a queued delivery) from refusing them too.
 */
export function isTuiOnlySlashCommand(text: string): boolean {
  const name = slashCommandName(text);
  if (name === null) return false;
  if (KABMO_OWNED_SLASH_COMMANDS[name] === true) return false;
  return TUI_ONLY_SLASH_COMMANDS[name] === true;
}

/**
 * The notice shown in place of a refused turn. Names the command and says where
 * it does work, because "not supported" alone leaves the user guessing whether
 * they mistyped it.
 */
export function tuiOnlyCommandNotice(text: string): string {
  const name = slashCommandName(text) ?? text.trim();
  return `\`/${name}\` is available in the omp terminal only — it has no effect over the RPC bridge, so it was not sent.`;
}
