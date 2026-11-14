/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a chord recorder must ignore.
 *
 * A modifier keydown is not a stroke. Recording `⌘P` used to store
 * `osleft cmd+p` — WebKit reports the Meta key as `OS`, so a `key`-only check
 * missed it — and the stored chord then failed to parse, which silently
 * unbound the command. Both the key and the code are checked because engines
 * disagree about the former and agree about the latter.
 */

const MODIFIER_KEYS: Record<string, true> = {
  Shift: true,
  Control: true,
  Alt: true,
  Meta: true,
  OS: true,
  Super: true,
  Hyper: true,
  CapsLock: true,
  Fn: true,
};

const MODIFIER_CODES: Record<string, true> = {
  ShiftLeft: true,
  ShiftRight: true,
  ControlLeft: true,
  ControlRight: true,
  AltLeft: true,
  AltRight: true,
  MetaLeft: true,
  MetaRight: true,
  OSLeft: true,
  OSRight: true,
  CapsLock: true,
};

export function isModifierKey(event: { key: string; code: string }): boolean {
  return MODIFIER_KEYS[event.key] === true || MODIFIER_CODES[event.code] === true;
}
