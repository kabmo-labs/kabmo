/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The workspace shortcuts.
 *
 * The table is what the panel tooltips read, so what matters is that every
 * binding is unique on a platform (a duplicate silently shadows one of them) and
 * that the chords are ones a browser or a text field does not already own —
 * binding ⌘W or ⌘T here would break the tab, and ⌘A would break every selection
 * in the app.
 */

import { describe, expect, test } from 'bun:test';

import { WORKSPACE_KEY_BINDINGS } from '@/shared/lib/workspace/keymap';
import { resolveBinding, strokeOf, type KeyboardEventLike } from '@/shared/lib/ui/key-binding';

function key(code: string, modifiers: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return { code, key: code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers };
}

/** Chords the browser or the OS owns; binding one would break the app. */
const RESERVED: Record<string, true> = {
  KeyW: true,
  KeyT: true,
  KeyN: true,
  KeyQ: true,
  KeyA: true,
  KeyR: true,
  KeyP: true,
};

describe('WORKSPACE_KEY_BINDINGS', () => {
  test('every binding carries a label and both platforms', () => {
    for (const binding of WORKSPACE_KEY_BINDINGS) {
      expect(binding.label.length).toBeGreaterThan(0);
      expect(binding.mac.code.length).toBeGreaterThan(0);
      expect(binding.other.code.length).toBeGreaterThan(0);
    }
  });

  test('no binding claims a chord the browser already owns', () => {
    for (const binding of WORKSPACE_KEY_BINDINGS) {
      expect(RESERVED[binding.mac.code]).toBeUndefined();
    }
  });

  test('no two commands claim the same chord on a platform', () => {
    for (const isMac of [true, false]) {
      const seen: Record<string, string> = {};
      for (const binding of WORKSPACE_KEY_BINDINGS) {
        const stroke = strokeOf(binding, isMac);
        const id = `${stroke.code}|${stroke.meta ? 'm' : ''}${stroke.ctrl ? 'c' : ''}${stroke.alt ? 'a' : ''}${stroke.shift ? 's' : ''}`;
        expect(`${binding.command} vs ${seen[id]}`).toBe(`${binding.command} vs undefined`);
        seen[id] = binding.command;
      }
    }
  });

  test('the panel toggles resolve from their own chords', () => {
    expect(resolveBinding(WORKSPACE_KEY_BINDINGS, key('KeyB', { metaKey: true }), true)).toBe('toggleSidebar');
    expect(resolveBinding(WORKSPACE_KEY_BINDINGS, key('KeyJ', { metaKey: true }), true)).toBe('toggleEditorPanel');
    expect(resolveBinding(WORKSPACE_KEY_BINDINGS, key('KeyJ', { metaKey: true, altKey: true }), true)).toBe('toggleRightPanel');
  });

  test('⌘J and ⌥⌘J are different commands, not the same one twice', () => {
    // The alt modifier is the only thing separating the editor and right panels.
    const plain = resolveBinding(WORKSPACE_KEY_BINDINGS, key('KeyJ', { metaKey: true }), true);
    const withAlt = resolveBinding(WORKSPACE_KEY_BINDINGS, key('KeyJ', { metaKey: true, altKey: true }), true);

    expect(plain).not.toBe(withAlt);
  });

  test('save is bound here but deliberately not handled by the layout', () => {
    // The editor panel owns ⌘S (it is the only surface with a buffer); this
    // binding exists so a tooltip can name the chord.
    expect(resolveBinding(WORKSPACE_KEY_BINDINGS, key('KeyS', { metaKey: true }), true)).toBe('saveFile');
  });
});
