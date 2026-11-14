/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import {
  chordKey,
  chordStartsWith,
  chordToText,
  formatChord,
  parseChord,
  strokeOfEvent,
} from '@/shared/lib/commands/chord';

describe('chords', () => {
  test('parses one and two strokes', () => {
    expect(parseChord('ctrl+k ctrl+c')).toEqual([
      { code: 'KeyK', ctrl: true },
      { code: 'KeyC', ctrl: true },
    ]);
    expect(parseChord('cmd+shift+p')).toEqual([{ code: 'KeyP', meta: true, shift: true }]);
  });

  test('maps punctuation, function keys and the numpad', () => {
    expect(parseChord('alt+,')).toEqual([{ code: 'Comma', alt: true }]);
    expect(parseChord('f3')).toEqual([{ code: 'F3' }]);
    expect(parseChord('numpad1')).toEqual([{ code: 'Numpad1' }]);
  });

  test('refuses an unknown key and a three-stroke chord', () => {
    expect(() => parseChord('hyper+q')).toThrow();
    expect(() => parseChord('a b c')).toThrow();
    expect(() => parseChord('')).toThrow();
  });

  test('round-trips through the stored text', () => {
    for (const text of ['cmd+shift+p', 'ctrl+k ctrl+c', 'alt+,', 'f3', 'shift+enter']) {
      expect(chordToText(parseChord(text))).toBe(text);
    }
  });

  test('prefix matching is what a pending chord needs', () => {
    const chord = parseChord('cmd+k cmd+s');
    expect(chordStartsWith(chord, parseChord('cmd+k'))).toBe(true);
    expect(chordStartsWith(chord, parseChord('cmd+s'))).toBe(false);
    expect(chordStartsWith(parseChord('cmd+k'), chord)).toBe(false);
  });

  test('prints the platform’s own names', () => {
    const chord = parseChord('cmd+shift+p');
    expect(formatChord(chord, true)).toContain('⇧');
    expect(formatChord(chord, false)).toContain('Shift');
  });

  test('a live event becomes the matcher’s stroke', () => {
    expect(
      strokeOfEvent({ code: 'KeyB', key: 'b', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    ).toEqual({ code: 'KeyB', meta: true });
  });

  test('the grouping key distinguishes modifier sets', () => {
    expect(chordKey(parseChord('cmd+b'))).not.toBe(chordKey(parseChord('cmd+shift+b')));
    expect(chordKey(parseChord('cmd+b'))).toBe(chordKey(parseChord('cmd+b')));
  });
});
