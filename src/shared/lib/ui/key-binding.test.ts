/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The chord matcher every shortcut in the app shares.
 *
 * Two failures are silent and both are covered here: matching on `event.key`
 * (which never fires on macOS, where Option produces a different character), and
 * a label that disagrees with the stroke it describes. The matcher is also
 * platform-guarded, so a chord from the other platform must not fire.
 */

import { describe, expect, test } from 'bun:test';

import {
  bindingFor,
  describeStroke,
  matchesStroke,
  printableKey,
  resolveBinding,
  strokeOf,
  type KeyBinding,
  type KeyboardEventLike,
} from '@/shared/lib/ui/key-binding';

type Command = 'open' | 'save' | 'redo';

const BINDINGS: readonly KeyBinding<Command>[] = [
  { command: 'open', label: 'Open', mac: { code: 'KeyO', meta: true }, other: { code: 'KeyO', ctrl: true } },
  { command: 'save', label: 'Save', mac: { code: 'KeyS', meta: true, shift: true }, other: { code: 'KeyS', ctrl: true, shift: true } },
  {
    command: 'redo',
    label: 'Redo',
    mac: { code: 'KeyZ', meta: true, shift: true },
    other: { code: 'KeyZ', ctrl: true, shift: true },
    windows: { code: 'KeyY', ctrl: true },
  },
];

function key(code: string, keyName: string, modifiers: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return { code, key: keyName, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers };
}

describe('matchesStroke', () => {
  test('requires the exact modifier set', () => {
    const stroke = { code: 'KeyF', meta: true };
    expect(matchesStroke(stroke, key('KeyF', 'f', { metaKey: true }))).toBe(true);
    expect(matchesStroke(stroke, key('KeyF', 'f', { metaKey: true, shiftKey: true }))).toBe(false);
    expect(matchesStroke(stroke, key('KeyF', 'f', { ctrlKey: true }))).toBe(false);
  });

  test('reads the physical key, not the character it produces', () => {
    // macOS reports ⌥⌘C as `Ç`; a `key`-based test would never fire there.
    expect(matchesStroke({ code: 'KeyC', meta: true, alt: true }, key('KeyC', 'Ç', { metaKey: true, altKey: true }))).toBe(true);
  });
});

describe('strokeOf', () => {
  test('picks the platform’s own chord', () => {
    expect(strokeOf(BINDINGS[0], true)).toEqual({ code: 'KeyO', meta: true });
    expect(strokeOf(BINDINGS[0], false)).toEqual({ code: 'KeyO', ctrl: true });
  });

  test('uses the Windows override only where it exists', () => {
    // Windows redoes with Ctrl+Y while Linux keeps Ctrl+Shift+Z; one `other`
    // stroke cannot express both — so `strokeOf` consults the PLATFORM for the
    // override and the `other` chord for everything else. `isWindowsPlatform()`
    // reads `navigator.platform`, which is whatever host the suite runs on, so
    // the override branch has to be selected explicitly rather than assumed: on
    // a Windows runner this assertion was reading the override's answer.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32' }, configurable: true });
    try {
      expect(strokeOf(BINDINGS[2], false)).toEqual({ code: 'KeyY', ctrl: true });
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
    // Off Windows the Linux chord stands.
    Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Linux x86_64' }, configurable: true });
    try {
      expect(strokeOf(BINDINGS[2], false)).toEqual({ code: 'KeyZ', ctrl: true, shift: true });
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });
});

describe('resolveBinding', () => {
  test('returns the command a chord names', () => {
    expect(resolveBinding(BINDINGS, key('KeyO', 'o', { metaKey: true }), true)).toBe('open');
    expect(resolveBinding(BINDINGS, key('KeyO', 'o', { ctrlKey: true }), false)).toBe('open');
  });

  test('a chord from the other platform never fires', () => {
    expect(resolveBinding(BINDINGS, key('KeyO', 'o', { ctrlKey: true }), true)).toBeNull();
    expect(resolveBinding(BINDINGS, key('KeyO', 'o', { metaKey: true }), false)).toBeNull();
  });

  test('an unbound chord resolves to nothing', () => {
    expect(resolveBinding(BINDINGS, key('KeyQ', 'q', { metaKey: true }), true)).toBeNull();
  });
});

describe('bindingFor', () => {
  test('finds the binding a tooltip needs to label', () => {
    expect(bindingFor(BINDINGS, 'save')?.label).toBe('Save');
    expect(bindingFor(BINDINGS, 'open')?.mac).toEqual({ code: 'KeyO', meta: true });
  });
});

describe('printableKey and describeStroke', () => {
  test('prints the physical key the way a reader expects', () => {
    expect(printableKey('KeyC')).toBe('C');
    expect(printableKey('Digit1')).toBe('1');
    expect(printableKey('Slash')).toBe('/');
    expect(printableKey('BracketLeft')).toBe('[');
    expect(printableKey('ArrowUp')).toBe('ArrowUp');
    expect(printableKey('F3')).toBe('F3');
  });

  test('mac chords render without separators, others with plus signs', () => {
    expect(describeStroke({ code: 'KeyC', meta: true, alt: true }, true)).toBe('⌥⌘C');
    expect(describeStroke({ code: 'KeyC', alt: true }, false)).toBe('Alt+C');
    expect(describeStroke({ code: 'Slash', ctrl: true }, false)).toBe('Ctrl+/');
  });

  test('modifier order is stable, so two labels for one chord cannot differ', () => {
    expect(describeStroke({ code: 'ArrowDown', meta: true, alt: true, shift: true }, true)).toBe('⌥⇧⌘ArrowDown');
  });
});
