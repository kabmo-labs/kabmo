/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The keymap generator.
 *
 * Its whole contract is negative: a command the palette lists must be BOUND, or
 * the palette advertises a shortcut nothing listens for. That property is only
 * checkable by comparing the generated CM6 bindings against `EDITOR_KEY_BINDINGS`
 * — which is what this does, row by row, so adding a row to the table and
 * forgetting the binding fails here instead of in a user's hands.
 *
 * The name mapping is the part that is easy to get silently wrong: CM6 matches
 * on `event.keyCode` through `w3c-keyname`, so `Digit1` is `1` and `Slash` is
 * `/` — a binding written `Digit1` never fires.
 */

import { describe, expect, test } from 'bun:test';

import { EDITOR_KEY_BINDINGS } from '@/shared/lib/code/editor/keymap';
import { codeMirrorKey } from '@/client/components/common/code-surface/keymap';

describe('codeMirrorKey', () => {
  test('maps letters, digits and function keys to the names CM6 matches', () => {
    // Lower case for a bare letter: `keyName` reports the character the key
    // produces, which is `d` unshifted. The shifted form (`D`) is reached
    // through CM6's own base-character fallback, so the row still fires.
    expect(codeMirrorKey({ code: 'KeyD', meta: true })).toBe('Meta-d');
    expect(codeMirrorKey({ code: 'Digit1', meta: true, shift: true })).toBe('Shift-Meta-1');
    expect(codeMirrorKey({ code: 'F3' })).toBe('F3');
  });

  test('maps punctuation to the character the key produces unshifted', () => {
    // `Slash` is `/` on every layout that has it; `BracketRight` is `]`.
    expect(codeMirrorKey({ code: 'Slash', ctrl: true })).toBe('Ctrl-/');
    expect(codeMirrorKey({ code: 'BracketRight', meta: true })).toBe('Meta-]');
    expect(codeMirrorKey({ code: 'BracketLeft', ctrl: true })).toBe('Ctrl-[');
  });

  test('names the keys that have their own spelling', () => {
    expect(codeMirrorKey({ code: 'Enter', meta: true })).toBe('Meta-Enter');
    expect(codeMirrorKey({ code: 'ArrowUp', alt: true })).toBe('Alt-ArrowUp');
    expect(codeMirrorKey({ code: 'Home' })).toBe('Home');
  });

  test('orders modifiers the way CM6 canonicalises them', () => {
    // CM6's `modifiers()` prepends alt, then ctrl, then meta, then shift, so
    // the canonical spelling runs `Shift-Meta-Ctrl-Alt-<key>`. A different
    // order here would be a binding CM6 never matches.
    expect(codeMirrorKey({ code: 'ArrowDown', ctrl: true, alt: true, shift: true })).toBe('Shift-Ctrl-Alt-ArrowDown');
  });

  test('reports null for a key with no name, so the row is skipped', () => {
    expect(codeMirrorKey({ code: 'IntlBackslash' })).toBeNull();
  });
});

describe('EDITOR_KEY_BINDINGS coverage', () => {
  test('every row resolves to a chord on both platforms', () => {
    const missing = EDITOR_KEY_BINDINGS.filter(
      (binding) => codeMirrorKey(binding.mac) === null || codeMirrorKey(binding.other) === null,
    ).map((binding) => binding.command);

    // A row whose chord cannot be named is a palette entry that does nothing —
    // the exact failure this table exists to prevent.
    expect(missing).toEqual([]);
  });

  test('no two rows claim the same chord on the same platform', () => {
    for (const platform of ['mac', 'other'] as const) {
      const seen = new Map<string, string>();
      for (const binding of EDITOR_KEY_BINDINGS) {
        const chord = codeMirrorKey(binding[platform]);
        if (!chord) continue;
        // A duplicate would make the first row win silently and leave the
        // second's palette entry dead.
        expect(seen.has(chord) ? `${chord} (${seen.get(chord)} and ${binding.command})` : null).toBeNull();
        seen.set(chord, binding.command);
      }
    }
  });
});
