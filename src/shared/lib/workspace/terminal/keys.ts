/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The keys a touch keyboard cannot produce, and the bytes they send.
 *
 * A phone's soft keyboard has no Ctrl, no Alt, no arrows, no Esc and no `|`, so
 * a shell on a phone is unusable without a strip of buttons that emit the raw
 * bytes those keys would. Every sequence here is what xterm's own
 * `evaluateKeyboardEvent` sends for the same physical key
 * (`@xterm/xterm/src/common/input/Keyboard.ts`) — the shell on the far end
 * cannot tell the two apart, so a bar key that invented its own encoding would
 * work in bash and break in vim.
 *
 * Three rules come straight out of that file:
 *  - A CSI key carries its modifiers as a PARAMETER (`ESC [ 1 ; 5 A` is
 *    Ctrl+Up), never as an ESC prefix; only a literal key gets the prefix.
 *  - Application cursor mode (DECCKM, which vim and less set) swaps the arrows
 *    and Home/End to their SS3 spelling (`ESC O A`), and a modifier wins over
 *    it — xterm ignores the mode once a modifier is held.
 *  - Ctrl has no literal spelling: it folds a typed character into a control
 *    character (Ctrl+C is `0x03`), so a literal button keeps its own byte.
 *
 * There is deliberately no Cmd key. macOS reports it as `metaKey` and xterm
 * discards it — `if (ev.metaKey) break;` in the cursor-key branches — because
 * Cmd is the browser's modifier, not the terminal's: in a terminal Cmd+C and
 * Cmd+V mean copy and paste, which is why those are actions in `KeyBar.tsx`
 * rather than bytes here.
 */

export type TerminalModifier = 'ctrl' | 'alt';

export interface TerminalModifiers {
  ctrl: boolean;
  alt: boolean;
}

/** Frozen, so clearing a latch is an identity change and re-renders nothing. */
export const NO_MODIFIERS: TerminalModifiers = Object.freeze({ ctrl: false, alt: false });

/** A CSI key: `ESC [ <prefix> <final>`, or `ESC O <final>` under DECCKM. */
interface CsiSpec {
  /** Leading parameter, dropped from the unmodified form when it is `1`. */
  prefix: string;
  final: string;
  /** SS3 spelling, used only while the shell has DECCKM set. */
  application?: string;
  /**
   * Spelling `terminfo` declares for the UNMODIFIED key, when it differs from
   * the CSI default. This is not cosmetic: a line editor binds the sequences its
   * terminfo entry names, so a key whose entry disagrees with what we send is
   * simply not recognised — zsh answers Home with a bell and does nothing.
   */
  terminfo?: string;
}

export interface TerminalKeyDef<Id extends string = string> {
  id: Id;
  /** Printed on the button — a glyph where one exists. */
  label: string;
  /** Spoken name: the button's `title` and `aria-label`. */
  name: string;
  /** Literal bytes, for keys with no CSI form. */
  sequence?: string;
  csi?: CsiSpec;
}

/** A key that is always a literal byte — a symbol, with no CSI form. */
export interface TerminalLiteralKeyDef<Id extends string = string> extends TerminalKeyDef<Id> {
  sequence: string;
}

/**
 * Control and cursor keys — the row that is always in reach.
 *
 * Ordered by how often a terminal needs it, because the bar wraps: the head
 * stays on the first row and the tail lands on the last.
 */
export const TERMINAL_KEYS: readonly TerminalKeyDef[] = [
  { id: 'escape', label: 'Esc', name: 'Escape', sequence: '\x1b' },
  { id: 'tab', label: 'Tab', name: 'Tab', sequence: '\t' },
  { id: 'interrupt', label: '^C', name: 'Ctrl+C — interrupt', sequence: '\x03' },
  { id: 'left', label: '←', name: 'Left arrow', csi: { prefix: '1', final: 'D', application: 'OD' } },
  { id: 'up', label: '↑', name: 'Up arrow', csi: { prefix: '1', final: 'A', application: 'OA' } },
  { id: 'down', label: '↓', name: 'Down arrow', csi: { prefix: '1', final: 'B', application: 'OB' } },
  { id: 'right', label: '→', name: 'Right arrow', csi: { prefix: '1', final: 'C', application: 'OC' } },
  // Home/End carry `terminfo` because xterm's CSI default is not what the
  // shell's terminfo entry names. `TERM=xterm-256color` declares khome/kend as
  // SS3 (`\EOH`/`\EOF`) — `infocmp xterm-256color` prints exactly that — while
  // xterm.js sends `ESC[H`/`ESC[F` whenever DECCKM is off, which is the state a
  // shell prompt is in. Verified against Kabmo's own zsh: the CSI form
  // makes ZLE ring the bell and leave the cursor where it was, the SS3 form
  // moves it.
  { id: 'home', label: 'Home', name: 'Home', csi: { prefix: '1', final: 'H', application: 'OH', terminfo: '\x1bOH' } },
  { id: 'end', label: 'End', name: 'End', csi: { prefix: '1', final: 'F', application: 'OF', terminfo: '\x1bOF' } },
  { id: 'pageUp', label: 'PgUp', name: 'Page up', csi: { prefix: '5', final: '~' } },
  { id: 'pageDown', label: 'PgDn', name: 'Page down', csi: { prefix: '6', final: '~' } },
  { id: 'delete', label: 'Del', name: 'Delete', csi: { prefix: '3', final: '~' } },
  { id: 'shiftTab', label: '⇧Tab', name: 'Shift+Tab', sequence: '\x1b[Z' },
  { id: 'eof', label: '^D', name: 'Ctrl+D — end of input', sequence: '\x04' },
  { id: 'clear', label: '^L', name: 'Ctrl+L — clear screen', sequence: '\x0c' },
];

/**
 * Symbols a phone buries behind its "123" / "#+=" layer, plus the ones no layer
 * has at all (`~`, `|`, `\`, backtick). Reaching `$` on an iOS keyboard is a
 * mode switch per character, which is what makes a shell on a phone unusable —
 * each of these is one tap.
 */
export const TERMINAL_SYMBOLS: readonly TerminalLiteralKeyDef[] = [
  { id: 'pipe', label: '|', name: 'Pipe', sequence: '|' },
  { id: 'tilde', label: '~', name: 'Tilde', sequence: '~' },
  { id: 'dollar', label: '$', name: 'Dollar', sequence: '$' },
  { id: 'asterisk', label: '*', name: 'Asterisk', sequence: '*' },
  { id: 'question', label: '?', name: 'Question mark', sequence: '?' },
  { id: 'underscore', label: '_', name: 'Underscore', sequence: '_' },
  { id: 'backslash', label: '\\', name: 'Backslash', sequence: '\\' },
  { id: 'slash', label: '/', name: 'Slash', sequence: '/' },
  { id: 'minus', label: '-', name: 'Minus', sequence: '-' },
  { id: 'equals', label: '=', name: 'Equals', sequence: '=' },
  { id: 'plus', label: '+', name: 'Plus', sequence: '+' },
  { id: 'ampersand', label: '&', name: 'Ampersand', sequence: '&' },
  { id: 'semicolon', label: ';', name: 'Semicolon', sequence: ';' },
  { id: 'colon', label: ':', name: 'Colon', sequence: ':' },
  { id: 'comma', label: ',', name: 'Comma', sequence: ',' },
  { id: 'dot', label: '.', name: 'Period', sequence: '.' },
  { id: 'at', label: '@', name: 'At sign', sequence: '@' },
  { id: 'percent', label: '%', name: 'Percent', sequence: '%' },
  { id: 'caret', label: '^', name: 'Caret', sequence: '^' },
  { id: 'hash', label: '#', name: 'Hash', sequence: '#' },
  { id: 'bang', label: '!', name: 'Exclamation mark', sequence: '!' },
  { id: 'parenOpen', label: '(', name: 'Open parenthesis', sequence: '(' },
  { id: 'parenClose', label: ')', name: 'Close parenthesis', sequence: ')' },
  { id: 'bracketOpen', label: '[', name: 'Open bracket', sequence: '[' },
  { id: 'bracketClose', label: ']', name: 'Close bracket', sequence: ']' },
  { id: 'braceOpen', label: '{', name: 'Open brace', sequence: '{' },
  { id: 'braceClose', label: '}', name: 'Close brace', sequence: '}' },
  { id: 'lessThan', label: '<', name: 'Less than', sequence: '<' },
  { id: 'greaterThan', label: '>', name: 'Greater than', sequence: '>' },
  { id: 'quote', label: "'", name: 'Single quote', sequence: "'" },
  { id: 'doubleQuote', label: '"', name: 'Double quote', sequence: '"' },
  { id: 'backtick', label: '`', name: 'Backtick', sequence: '`' },
];

export type TerminalKeyId = (typeof TERMINAL_KEYS)[number]['id'] | (typeof TERMINAL_SYMBOLS)[number]['id'];

/** Every key the bar can send, indexed for lookup. An unknown id resolves to nothing. */
const KEY_BY_ID: Partial<Record<TerminalKeyId, TerminalKeyDef>> = {};
for (const def of [...TERMINAL_KEYS, ...TERMINAL_SYMBOLS]) KEY_BY_ID[def.id as TerminalKeyId] = def;

export interface ResolveKeyOptions {
  /** The shell's DECCKM state — xterm reports it as `term.modes`. */
  applicationCursorKeys?: boolean;
  modifiers?: TerminalModifiers;
}

/** The bytes one bar button sends. */
export function resolveKeySequence(id: TerminalKeyId, options: ResolveKeyOptions = {}): string {
  const def = KEY_BY_ID[id];
  if (!def) return '';
  const modifiers = options.modifiers ?? NO_MODIFIERS;
  if (def.csi) return encodeCsi(def.csi, modifiers, options.applicationCursorKeys ?? false);
  // A literal key keeps its own byte: Ctrl is a latch for typed text and a CSI
  // parameter for a cursor key, so a tapped `|` is a pipe, not FS.
  const sequence = def.sequence ?? '';
  return modifiers.alt ? `\x1b${sequence}` : sequence;
}

function encodeCsi(spec: CsiSpec, modifiers: TerminalModifiers, applicationCursorKeys: boolean): string {
  const parameter = modifierParameter(modifiers);
  if (parameter !== null) return `\x1b[${spec.prefix};${parameter}${spec.final}`;
  // Unmodified: `terminfo` first, then DECCKM, then xterm's CSI default. A line
  // editor binds the sequences its terminfo entry names, so the entry is the
  // authority — the DECCKM check below it is only for the keys whose entry and
  // xterm's default already agree (the arrows).
  if (spec.terminfo) return spec.terminfo;
  if (applicationCursorKeys && spec.application) return `\x1b${spec.application}`;
  return `\x1b[${spec.prefix === '1' ? '' : spec.prefix}${spec.final}`;
}

/** xterm's modifier parameter: 1 + shift(1) + alt(2) + ctrl(4). No modifier, no parameter. */
function modifierParameter(modifiers: TerminalModifiers): number | null {
  const bits = (modifiers.alt ? 2 : 0) | (modifiers.ctrl ? 4 : 0);
  return bits === 0 ? null : bits + 1;
}

/**
 * Fold a latched modifier into text typed on the soft keyboard — the path a
 * phone has no other way to reach. Ctrl+C typed as `c` must arrive as `0x03`,
 * and Alt as the ESC prefix (the meta behaviour every terminal has).
 *
 * Only a single character folds: a paste arrives through the same event, and
 * prefixing an ESC to a whole pasted line (or folding its first character into
 * a control code) would corrupt it.
 */
export function applyModifiers(data: string, modifiers: TerminalModifiers): string {
  if (data.length !== 1) return data;
  let out = data;
  if (modifiers.ctrl) out = ctrlCharacter(out) ?? out;
  if (modifiers.alt) out = `\x1b${out}`;
  return out;
}

const CTRL_SYMBOLS: Record<string, string> = {
  '@': '\x00',
  ' ': '\x00',
  '\x7f': '\x08',
  '[': '\x1b',
  '\\': '\x1c',
  ']': '\x1d',
  '^': '\x1e',
  '_': '\x1f',
  '?': '\x7f',
};

/** The control character a letter or symbol folds into, or null when it has none. */
export function ctrlCharacter(character: string): string | null {
  if (character.length !== 1) return null;
  const code = character.charCodeAt(0);
  if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code - 0x60);
  if (code >= 0x41 && code <= 0x5a) return String.fromCharCode(code - 0x40);
  return CTRL_SYMBOLS[character] ?? null;
}
