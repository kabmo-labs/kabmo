/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Chords as text, and as the strokes the matcher compares.
 *
 * Dispatch is on `KeyboardEvent.code` (physical key), so a binding means the
 * same key on AZERTY and QWERTY. Display goes through `describeStroke`, which
 * already owns the printed names.
 */

import type { KeyboardEventLike, KeyStroke } from '@/shared/lib/ui/key-binding';
import { describeStroke } from '@/shared/lib/ui/key-binding';
import type { Chord } from '@/shared/lib/commands/types';

const MODIFIERS: Record<string, 'meta' | 'ctrl' | 'alt' | 'shift'> = {
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  win: 'meta',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

const NAMED_CODES: Record<string, string> = {
  enter: 'Enter',
  return: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  arrowup: 'ArrowUp',
  down: 'ArrowDown',
  arrowdown: 'ArrowDown',
  left: 'ArrowLeft',
  arrowleft: 'ArrowLeft',
  right: 'ArrowRight',
  arrowright: 'ArrowRight',
  capslock: 'CapsLock',
  pausebreak: 'Pause',
  numpadadd: 'NumpadAdd',
  numpadsubtract: 'NumpadSubtract',
  numpadmultiply: 'NumpadMultiply',
  numpaddivide: 'NumpadDivide',
  numpaddecimal: 'NumpadDecimal',
  numpadseparator: 'NumpadSeparator',
};

const PUNCTUATION_CODES: Record<string, string> = {
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
};

/** The `KeyboardEvent.code` a written key name means. Throws on an unknown name. */
function codeFor(name: string): string {
  const lower = name.toLowerCase();
  if (NAMED_CODES[lower]) return NAMED_CODES[lower];
  if (PUNCTUATION_CODES[name]) return PUNCTUATION_CODES[name];
  if (/^[a-z]$/.test(lower)) return `Key${lower.toUpperCase()}`;
  if (/^[0-9]$/.test(lower)) return `Digit${lower}`;
  if (/^f([1-9]|1[0-9])$/.test(lower)) return lower.toUpperCase();
  if (/^numpad[0-9]$/.test(lower)) return `Numpad${lower.slice(-1)}`;
  throw new Error(`unknown key "${name}" in chord`);
}

/** Parse `ctrl+k ctrl+c` into strokes. Throws on an unknown key or an empty chord. */
export function parseChord(text: string): Chord {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error('empty chord');
  if (parts.length > 2) throw new Error(`a chord has at most two strokes: ${text}`);
  return parts.map((part) => {
    const pieces = part.split('+').filter(Boolean);
    if (pieces.length === 0) throw new Error(`empty stroke in chord: ${text}`);
    const stroke: { code: string; meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {
      code: '',
    };
    for (const piece of pieces) {
      const modifier = MODIFIERS[piece.toLowerCase()];
      if (modifier) {
        stroke[modifier] = true;
        continue;
      }
      if (stroke.code) throw new Error(`two keys in one stroke: ${part}`);
      stroke.code = codeFor(piece);
    }
    if (!stroke.code) throw new Error(`a stroke needs a key: ${part}`);
    return stroke;
  });
}

/** The printed chord: `⌥⌘C` on macOS, `Alt+C` elsewhere. */
export function formatChord(chord: Chord, isMac: boolean): string {
  return chord.map((stroke) => describeStroke(stroke, isMac)).join(' ');
}

/** Whether `chord` begins with `prefix` — the test a pending chord needs. */
export function chordStartsWith(chord: Chord, prefix: Chord): boolean {
  if (prefix.length > chord.length) return false;
  return prefix.every((stroke, index) => sameStroke(stroke, chord[index]));
}

export function sameStroke(a: KeyStroke, b: KeyStroke): boolean {
  return (
    a.code === b.code &&
    Boolean(a.meta) === Boolean(b.meta) &&
    Boolean(a.ctrl) === Boolean(b.ctrl) &&
    Boolean(a.alt) === Boolean(b.alt) &&
    Boolean(a.shift) === Boolean(b.shift)
  );
}

/** The stroke a live event carries, in the matcher's shape. */
export function strokeOfEvent(event: KeyboardEventLike): KeyStroke {
  return {
    code: event.code,
    ...(event.metaKey ? { meta: true } : {}),
    ...(event.ctrlKey ? { ctrl: true } : {}),
    ...(event.altKey ? { alt: true } : {}),
    ...(event.shiftKey ? { shift: true } : {}),
  };
}

// First name wins: `enter` and `return` share a code, and the stored text must
// round-trip to the spelling a user would write.
const NAME_BY_CODE: Record<string, string> = {};
for (const [name, code] of Object.entries(NAMED_CODES)) {
  if (!NAME_BY_CODE[code]) NAME_BY_CODE[code] = name;
}
const PUNCTUATION_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(PUNCTUATION_CODES).map(([name, code]) => [code, name]),
);

/** The key name a `KeyboardEvent.code` prints as, for a stored chord. */
function nameFor(code: string): string {
  if (PUNCTUATION_BY_CODE[code]) return PUNCTUATION_BY_CODE[code];
  if (NAME_BY_CODE[code]) return NAME_BY_CODE[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9])$/.test(code)) return code.toLowerCase();
  if (/^Numpad[0-9]$/.test(code)) return `numpad${code.slice(-1)}`;
  return code.toLowerCase();
}

/** The parseable text of a chord: `meta+KeyB` becomes `cmd+b`. */
export function chordToText(chord: Chord): string {
  return chord
    .map((stroke) => {
      const parts: string[] = [];
      if (stroke.meta) parts.push('cmd');
      if (stroke.ctrl) parts.push('ctrl');
      if (stroke.alt) parts.push('alt');
      if (stroke.shift) parts.push('shift');
      parts.push(nameFor(stroke.code));
      return parts.join('+');
    })
    .join(' ');
}

/** A stable key for grouping rules by chord (conflict detection, lookups). */
export function chordKey(chord: Chord): string {
  return chord
    .map((stroke) =>
      [stroke.code, stroke.meta ? 'm' : '', stroke.ctrl ? 'c' : '', stroke.alt ? 'a' : '', stroke.shift ? 's' : ''].join(
        '+',
      ),
    )
    .join(' ');
}
