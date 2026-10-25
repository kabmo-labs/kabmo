/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor keymap's contract.
 *
 * These assertions exist because the failure mode is silent: a chord matched on
 * `event.key` never fires on macOS (Option produces a different character), a
 * platform whose binding was forgotten makes a documented shortcut dead, and a
 * label that disagrees with the stroke it describes turns a tooltip into a
 * lie. Each of those is a test here rather than a bug report.
 */

import { describe, expect, test } from 'bun:test';

import { EDITOR_KEY_BINDINGS, editorStrokeFor, isFindBarCommand } from '@/shared/lib/code/editor/keymap';
import { describeBinding, resolveBinding, type KeyboardEventLike, type KeyBinding } from '@/shared/lib/ui/key-binding';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';

/** A keyboard event with only the fields the matcher reads. */
function key(code: string, keyName: string, modifiers: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return { code, key: keyName, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers };
}

function commandFor(event: KeyboardEventLike, isMac: boolean): EditorCommand | null {
  return resolveBinding(EDITOR_KEY_BINDINGS, event, isMac);
}

describe('editor keymap', () => {
  test('⌘D adds the next occurrence, ⇧⌘D inserts a cursor below', () => {
    expect(commandFor(key('KeyD', 'd', { metaKey: true }), true)).toBe('selectNextOccurrence');
    expect(commandFor(key('KeyD', 'd', { ctrlKey: true }), false)).toBe('selectNextOccurrence');
    expect(commandFor(key('KeyD', 'd', { metaKey: true, shiftKey: true }), true)).toBe('insertCursorBelow');
  });

  test('a binding from the other platform never fires', () => {
    // Ctrl+D on macOS is the emacs forward-delete; ⌘D on Windows belongs to nobody.
    expect(commandFor(key('KeyD', 'd', { ctrlKey: true }), true)).toBeNull();
    expect(commandFor(key('KeyD', 'd', { metaKey: true }), false)).toBeNull();
  });

  test('the line commands use the arrows with the modifiers each platform expects', () => {
    expect(commandFor(key('ArrowUp', 'ArrowUp', { altKey: true }), true)).toBe('moveLineUp');
    expect(commandFor(key('ArrowDown', 'ArrowDown', { altKey: true }), true)).toBe('moveLineDown');
    expect(commandFor(key('ArrowDown', 'ArrowDown', { metaKey: true, altKey: true, shiftKey: true }), true)).toBe('copyLineDown');
    expect(commandFor(key('KeyK', 'k', { metaKey: true, shiftKey: true }), true)).toBe('deleteLine');
  });

  test('toggle comment is read from the physical Slash key', () => {
    expect(commandFor(key('Slash', '/', { metaKey: true }), true)).toBe('toggleComment');
    expect(commandFor(key('Slash', '/', { ctrlKey: true }), false)).toBe('toggleComment');
  });

  test('every command carries both platforms and a label', () => {
    for (const binding of EDITOR_KEY_BINDINGS) {
      expect(binding.label.length).toBeGreaterThan(0);
      expect(binding.mac.code.length).toBeGreaterThan(0);
      expect(binding.other.code.length).toBeGreaterThan(0);
    }
  });

  test('no two commands claim the same chord on a platform', () => {
    for (const isMac of [true, false]) {
      const seen = new Map<string, EditorCommand>();
      for (const binding of EDITOR_KEY_BINDINGS) {
        const stroke = editorStrokeFor(binding.command, isMac, false);
        if (!stroke) continue;
        const id = `${stroke.code}|${stroke.meta ? 'm' : ''}${stroke.ctrl ? 'c' : ''}${stroke.alt ? 'a' : ''}${stroke.shift ? 's' : ''}`;
        const owner = seen.get(id);
        expect(`${binding.command} vs ${owner}`).toBe(`${binding.command} vs undefined`);
        seen.set(id, binding.command);
      }
    }
  });

  test('redo has a Windows-only chord without disturbing the others', () => {
    expect(editorStrokeFor('redo', true, false)).toEqual({ code: 'KeyZ', meta: true, shift: true });
    expect(editorStrokeFor('redo', false, true)).toEqual({ code: 'KeyY', ctrl: true });
    expect(editorStrokeFor('redo', false, false)).toEqual({ code: 'KeyZ', ctrl: true, shift: true });
  });

  test('the find-bar commands are exactly the ones the bar owns', () => {
    expect(isFindBarCommand('find')).toBe(true);
    expect(isFindBarCommand('toggleComment')).toBe(false);
    expect(isFindBarCommand('selectNextOccurrence')).toBe(false);
  });

  test('folding is bound on both platforms, on chords the app already owns', () => {
    // These are CM6's own `foldKeymap` chords. The reason this test exists is
    // that the palette and the tooltips read the SAME table: a fold command
    // listed with a chord nothing binds is the bug the table prevents.
    expect(commandFor(key('BracketLeft', '[', { ctrlKey: true, shiftKey: true }), false)).toBe('fold');
    expect(commandFor(key('BracketRight', ']', { ctrlKey: true, shiftKey: true }), false)).toBe('unfold');
    expect(commandFor(key('BracketLeft', '[', { metaKey: true, altKey: true }), true)).toBe('fold');
    expect(commandFor(key('BracketRight', ']', { metaKey: true, altKey: true }), true)).toBe('unfold');
    // Ctrl-Alt on both: CM6 binds it without a platform override, and it is the
    // one fold chord that cannot collide with macOS's ⌥⌘ pair.
    expect(commandFor(key('BracketLeft', '[', { ctrlKey: true, altKey: true }), false)).toBe('foldAll');
    expect(commandFor(key('BracketRight', ']', { ctrlKey: true, altKey: true }), false)).toBe('unfoldAll');
  });

  test('the fold chords do not collide with indent or outdent', () => {
    // `⌘]` indents and `⌘⌥]` unfolds: one modifier apart, which is exactly the
    // pair a hand-written table gets wrong.
    expect(editorStrokeFor('indent', true, false)).toEqual({ code: 'BracketRight', meta: true });
    expect(editorStrokeFor('unfold', true, false)).toEqual({ code: 'BracketRight', meta: true, alt: true });
    expect(editorStrokeFor('indent', false, false)).toEqual({ code: 'BracketRight', ctrl: true });
    expect(editorStrokeFor('unfold', false, false)).toEqual({ code: 'BracketRight', ctrl: true, shift: true });
  });
});

describe('binding labels', () => {
  const binding = (command: EditorCommand): KeyBinding<EditorCommand> => {
    const found = EDITOR_KEY_BINDINGS.find((entry) => entry.command === command);
    if (!found) throw new Error(`no binding for ${command}`);
    return found;
  };

  test('mac chords render without separators', () => {
    expect(describeBinding(binding('selectNextOccurrence'), true)).toBe('⌘D');
    expect(describeBinding(binding('copyLineDown'), true)).toBe('⌥⇧⌘ArrowDown');
    expect(describeBinding(binding('toggleComment'), true)).toBe('⌘/');
  });

  test('other platforms render with + separators', () => {
    expect(describeBinding(binding('selectNextOccurrence'), false)).toBe('Ctrl+D');
    expect(describeBinding(binding('moveLineUp'), false)).toBe('Alt+ArrowUp');
    expect(describeBinding(binding('lineStart'), false)).toBe('Home');
  });
});
