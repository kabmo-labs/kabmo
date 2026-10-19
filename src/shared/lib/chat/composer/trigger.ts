import type { CommandItem, ComposerMatchItem, ComposerPickItem, ComposerTrigger } from '@/shared/types';

/** Chars that may legally precede an `@` agent trigger (besides string start). */
const AT_PRECEDING_RE = /[\s([{]/;

/** oh-my-pi's `SKILL_NAMESPACE`: skills are addressed as `/skill:<name>`. */
export const SKILL_NAMESPACE = 'skill:';

/** The collapsed namespace row's token (no trailing space on accept). */
export const SKILL_NAMESPACE_TOKEN = `/${SKILL_NAMESPACE}`;

/**
 * Slash commands Kabmo answers itself, reserved exactly like oh-my-pi
 * reserves its own tokens.
 *
 * omp's `/btw` is TUI-only — its registry entry has `handleTui` and no
 * text-mode `handle`, and `get_available_commands` only advertises entries the
 * RPC dispatcher can run — so the composer would offer every command except the
 * one it intercepts on send. The entry is byte-for-byte omp's own metadata
 * (description and inline hint), so the popup reads the same in both clients.
 */
export const KABMO_COMMANDS: CommandItem[] = [
  {
    id: 'kabmo-btw',
    name: 'btw',
    description: "Ask a side question, or browse this session's BTW history",
    scope: 'system',
    template: '',
    isBuiltIn: true,
    inputHint: '[question]',
  },
  {
    // omp registers `/plan` with `handleTui` only, so `get_available_commands`
    // never advertises it — the popup would offer every command except the one
    // this client can now run. Descriptions are omp's own wording.
    id: 'kabmo-plan',
    name: 'plan',
    description: 'Toggle plan mode (agent plans before executing)',
    scope: 'system',
    template: '',
    isBuiltIn: true,
    inputHint: '[prompt]',
  },
  {
    id: 'kabmo-goal',
    name: 'goal',
    description: 'Toggle goal mode (persistent autonomous objective for this session)',
    scope: 'system',
    template: '',
    isBuiltIn: true,
    inputHint: '[objective]',
  },
];

/** True when Kabmo intercepts this command instead of forwarding it to
 *  omp as chat text. */
function isKabmoOwnedCommand(name: string): boolean {
  const lower = name.toLowerCase();
  return KABMO_COMMANDS.some((command) => command.name.toLowerCase() === lower);
}

/**
 * Index of a `/` that starts the draft, ignoring leading whitespace —
 * oh-my-pi's `findLeadingSlashCommandStart`.
 */
function leadingSlashStart(text: string): number | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) return null;
  return text.length - trimmed.length;
}

/**
 * Index of a `/` that opens the trailing token (`/(?:^|\s)\/([^\s/]*)$`) —
 * oh-my-pi's `findTrailingSlashCommandStart`.
 */
function trailingSlashStart(text: string): number | null {
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(text);
  if (!match || match.index === undefined) return null;
  const slashOffset = match[0].indexOf('/');
  return match.index + slashOffset;
}

/**
 * Whether prose precedes the slash token: any earlier non-blank line, or
 * non-whitespace before it on this line — oh-my-pi's
 * `hasPromptTextBeforeSlash`. Such a token is a mid-prompt skill lookup,
 * which only ever surfaces skills.
 */
function hasPromptTextBeforeSlash(lines: readonly string[], line: number, before: string, slashStart: number): boolean {
  for (let i = 0; i < line; i += 1) {
    if ((lines[i] ?? '').trim() !== '') return true;
  }
  return before.slice(0, slashStart).trim() !== '';
}

/**
 * Detect an `@`-mention (files + agents) or `/`-command trigger at the given
 * caret position, mirroring oh-my-pi's `CombinedAutocompleteProvider`:
 *
 * - `/` starts a command at the draft start (leading whitespace allowed) or as
 *   a trailing token after whitespace on the caret's line. A `/` in the middle
 *   of a token (`a/b`) never matches.
 * - Once `<command> ` is typed, the popup switches to the `args` phase, which
 *   completes that command's declarative subcommands.
 * - `@` is a trigger at index 0 or when preceded by whitespace, `(`, `[`, `{`.
 *
 * `lines` is the whole draft split on newlines and `line` the caret's line
 * index, because the mid-prompt rule inspects earlier lines.
 */
export function detectComposerTrigger(text: string, caret: number): ComposerTrigger | null {
  const end = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, end);
  // Mid-prompt detection needs the earlier lines, and every rule below is
  // scoped to the caret's own line.
  const lines = text.split('\n');
  const line = (before.match(/\n/g) ?? []).length;
  const lineStart = before.lastIndexOf('\n') + 1;
  const beforeOnLine = before.slice(lineStart);

  const leadStart = leadingSlashStart(beforeOnLine);
  const trailStart = trailingSlashStart(beforeOnLine);
  const midPrompt = trailStart !== null && hasPromptTextBeforeSlash(lines, line, beforeOnLine, trailStart);
  const leadIsMidPrompt = leadStart !== null && hasPromptTextBeforeSlash(lines, line, beforeOnLine, leadStart);

  const slashStart = midPrompt ? trailStart : leadIsMidPrompt ? null : leadStart;

  if (slashStart !== null) {
    const commandText = beforeOnLine.slice(slashStart);
    const spaceIndex = commandText.indexOf(' ');

    if (spaceIndex === -1) {
      return {
        kind: 'command',
        query: commandText.slice(1),
        start: lineStart + slashStart,
        end,
        phase: 'name',
        replaceFrom: lineStart + slashStart,
        ...(midPrompt ? { midPrompt: true } : {}),
      };
    }

    if (!midPrompt) {
      // Argument phase: everything after `<command> ` completes that command's
      // subcommands. oh-my-pi anchors the replacement on the argument text
      // only, so earlier arguments survive acceptance.
      const argStart = lineStart + slashStart + spaceIndex + 1;
      return {
        kind: 'command',
        query: before.slice(argStart),
        start: lineStart + slashStart,
        end,
        phase: 'args',
        replaceFrom: argStart,
        command: commandText.slice(1, spaceIndex),
      };
    }
  }

  // `@` mentions scan back to the token start; whitespace aborts the scan so
  // `foo@bar` never triggers.
  for (let i = beforeOnLine.length - 1; i >= 0; i--) {
    const ch = beforeOnLine[i];

    if (/\s/.test(ch)) return null;

    if (ch === '@') {
      if (i === 0 || AT_PRECEDING_RE.test(beforeOnLine[i - 1])) {
        const at = lineStart + i;
        return { kind: 'mention', query: before.slice(at + 1), start: at, end, phase: 'name', replaceFrom: at };
      }
      return null;
    }
  }

  return null;
}

/** Insertion text for an item: its token, plus a trailing space unless suppressed. */
export function tokenForItem(item: ComposerPickItem): string {
  return item.insertWithoutSpace ? item.token : `${item.token} `;
}

/**
 * Whether a popup accept should stand aside and let Enter mean "send".
 *
 * Only Kabmo's own commands qualify: the composer intercepts those on
 * send, so for `/btw` the Enter *is* the action and accept-on-Enter would
 * swallow the very keystroke the user is aiming at. Every command omp owns
 * keeps accepting, which is what opens its argument completions — including the
 * ones that declare no subcommands and take free-form arguments.
 */
export function sendInsteadOfAccept(trigger: ComposerTrigger, item: ComposerMatchItem | undefined): boolean {
  if (!item || trigger.kind !== 'command' || trigger.phase !== 'name') return false;
  if (item.name.toLowerCase() !== trigger.query.toLowerCase()) return false;
  return isKabmoOwnedCommand(item.name);
}

/** Splice `token` over the trigger span in `value`, returning the new value and caret. */
export function insertToken(
  value: string,
  trigger: ComposerTrigger,
  token: string,
): { value: string; caret: number } {
  const next = value.slice(0, trigger.replaceFrom) + token + value.slice(trigger.end);
  return { value: next, caret: trigger.replaceFrom + token.length };
}
