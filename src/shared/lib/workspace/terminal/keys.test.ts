/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The bytes the terminal key bar sends.
 *
 * Every expectation here is copied from xterm's own `evaluateKeyboardEvent`
 * (`@xterm/xterm/src/common/input/Keyboard.ts`), because the shell cannot tell a
 * bar button from a physical key: a sequence that merely looks plausible works
 * in bash and breaks in vim. Three of those rules are the ones this file exists
 * to pin — a modifier is a CSI PARAMETER and not an ESC prefix, application
 * cursor mode swaps in the SS3 spelling, and Ctrl on a literal key is a latch
 * for typed text rather than a byte to fold.
 */

import { describe, expect, test } from 'bun:test';

import {
  NO_MODIFIERS,
  TERMINAL_KEYS,
  TERMINAL_SYMBOLS,
  applyModifiers,
  ctrlCharacter,
  resolveKeySequence,
  type TerminalModifiers,
} from '@/shared/lib/workspace/terminal/keys';

const CTRL: TerminalModifiers = { ctrl: true, alt: false };
const ALT: TerminalModifiers = { ctrl: false, alt: true };

describe('resolveKeySequence — cursor keys', () => {
  test('unmodified arrows use CSI', () => {
    expect(resolveKeySequence('up')).toBe('\x1b[A');
    expect(resolveKeySequence('down')).toBe('\x1b[B');
    expect(resolveKeySequence('right')).toBe('\x1b[C');
    expect(resolveKeySequence('left')).toBe('\x1b[D');
  });

  test('application cursor mode swaps in the SS3 spelling', () => {
    const options = { applicationCursorKeys: true };
    expect(resolveKeySequence('up', options)).toBe('\x1bOA');
    expect(resolveKeySequence('left', options)).toBe('\x1bOD');
  });

  test('Home and End always use the terminfo spelling, DECCKM or not', () => {
    // `TERM=xterm-256color` declares khome/kend as SS3, so the CSI form is a
    // sequence the shell does not bind: zsh rings the bell and ignores it.
    expect(resolveKeySequence('home')).toBe('\x1bOH');
    expect(resolveKeySequence('end')).toBe('\x1bOF');
    expect(resolveKeySequence('home', { applicationCursorKeys: true })).toBe('\x1bOH');
    expect(resolveKeySequence('end', { applicationCursorKeys: true })).toBe('\x1bOF');
  });

  test('a modifier beats application cursor mode, as xterm does', () => {
    const options = { applicationCursorKeys: true, modifiers: CTRL };
    expect(resolveKeySequence('up', options)).toBe('\x1b[1;5A');
  });

  test('a modifier is a CSI parameter, never an ESC prefix', () => {
    expect(resolveKeySequence('up', { modifiers: CTRL })).toBe('\x1b[1;5A');
    expect(resolveKeySequence('up', { modifiers: ALT })).toBe('\x1b[1;3A');
    expect(resolveKeySequence('up', { modifiers: { ctrl: true, alt: true } })).toBe('\x1b[1;7A');
  });
});

describe('resolveKeySequence — keys with a fixed spelling', () => {
  test('an unmodified page/delete key drops its leading 1', () => {
    expect(resolveKeySequence('delete')).toBe('\x1b[3~');
    expect(resolveKeySequence('pageUp')).toBe('\x1b[5~');
    expect(resolveKeySequence('pageDown')).toBe('\x1b[6~');
  });

  test('page keys carry their prefix once modified', () => {
    expect(resolveKeySequence('pageUp', { modifiers: CTRL })).toBe('\x1b[5;5~');
    expect(resolveKeySequence('delete', { modifiers: ALT })).toBe('\x1b[3;3~');
  });

  test('a page key has no SS3 form, so DECCKM does not touch it', () => {
    expect(resolveKeySequence('pageUp', { applicationCursorKeys: true })).toBe('\x1b[5~');
  });

  test('escape, tab and shift-tab are literal', () => {
    expect(resolveKeySequence('escape')).toBe('\x1b');
    expect(resolveKeySequence('tab')).toBe('\t');
    expect(resolveKeySequence('shiftTab')).toBe('\x1b[Z');
  });
});

describe('resolveKeySequence — modifiers on a literal key', () => {
  test('Ctrl does NOT fold a literal key into a control byte', () => {
    // The `^C` button is the only Ctrl+C. A tapped `|` stays a pipe: folding it
    // would send FS (0x1c), which is not a pipe and not a signal.
    expect(resolveKeySequence('pipe', { modifiers: CTRL })).toBe('|');
    expect(resolveKeySequence('underscore', { modifiers: CTRL })).toBe('_');
  });

  test('Alt on a literal key is the ESC prefix', () => {
    expect(resolveKeySequence('pipe', { modifiers: ALT })).toBe('\x1b|');
    expect(resolveKeySequence('escape', { modifiers: ALT })).toBe('\x1b\x1b');
  });

  test('the dedicated control keys are already the folded byte', () => {
    expect(resolveKeySequence('interrupt')).toBe('\x03');
    expect(resolveKeySequence('eof')).toBe('\x04');
    expect(resolveKeySequence('clear')).toBe('\x0c');
  });
});

describe('resolveKeySequence — defaults and coverage', () => {
  test('no options means no modifier and no application mode', () => {
    // `pageUp` is the plain CSI default; Home/End carry a terminfo spelling.
    expect(resolveKeySequence('pageUp')).toBe('\x1b[5~');
    expect(NO_MODIFIERS).toEqual({ ctrl: false, alt: false });
  });

  test('every control key resolves to bytes', () => {
    for (const def of TERMINAL_KEYS) {
      expect(resolveKeySequence(def.id).length, def.id).toBeGreaterThan(0);
    }
  });

  test('every symbol resolves to its own literal', () => {
    for (const def of TERMINAL_SYMBOLS) {
      expect(resolveKeySequence(def.id), def.id).toBe(def.sequence);
    }
  });

  test('the symbol layer covers the characters a phone buries', () => {
    const labels = new Set(TERMINAL_SYMBOLS.map((def) => def.label));
    for (const required of ['|', '~', '\\', '$', '*', '?', '&', '<', '>', '`', '{', '}', '[', ']', '"', "'"]) {
      expect(labels.has(required), required).toBe(true);
    }
  });

  test('a symbol under a latched Alt is an ESC prefix, like any literal', () => {
    expect(resolveKeySequence('dollar', { modifiers: ALT })).toBe('\x1b$');
  });

  test('an unknown id sends nothing rather than a guess', () => {
    expect(resolveKeySequence('nope' as never)).toBe('');
  });
});

describe('ctrlCharacter', () => {
  test('letters fold case-insensitively onto C0', () => {
    expect(ctrlCharacter('c')).toBe('\x03');
    expect(ctrlCharacter('C')).toBe('\x03');
    expect(ctrlCharacter('a')).toBe('\x01');
    expect(ctrlCharacter('z')).toBe('\x1a');
  });

  test('the symbol set matches the terminal, not the ASCII table', () => {
    expect(ctrlCharacter('@')).toBe('\x00');
    expect(ctrlCharacter(' ')).toBe('\x00');
    expect(ctrlCharacter('[')).toBe('\x1b');
    expect(ctrlCharacter('_')).toBe('\x1f');
    expect(ctrlCharacter('?')).toBe('\x7f');
    expect(ctrlCharacter('!')).toBeNull();
    expect(ctrlCharacter('ab')).toBeNull();
  });
});

describe('applyModifiers', () => {
  test('a latched Ctrl folds a typed letter', () => {
    expect(applyModifiers('c', CTRL)).toBe('\x03');
    expect(applyModifiers('r', CTRL)).toBe('\x12');
  });

  test('a latched Alt prefixes ESC', () => {
    expect(applyModifiers('b', ALT)).toBe('\x1bb');
    expect(applyModifiers('f', { ctrl: true, alt: true })).toBe('\x1b\x06');
  });

  test('no modifier is the identity', () => {
    expect(applyModifiers('c', NO_MODIFIERS)).toBe('c');
  });

  test('a paste is left intact — the latch does not corrupt it', () => {
    const pasted = 'bun run build\n';
    expect(applyModifiers(pasted, CTRL)).toBe(pasted);
    expect(applyModifiers(pasted, ALT)).toBe(pasted);
  });

  test('a character with no control code passes through', () => {
    expect(applyModifiers('!', CTRL)).toBe('!');
  });
});
