/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One chord matcher for every shortcut in the app.
 *
 * The editor's find bar, the editor's own commands and the panel shortcuts all
 * have to answer the same question — "is this event this chord?" — and they
 * must answer it identically or the same physical key means different things
 * depending on which surface has focus. They also have to *describe* it
 * identically: a tooltip that reads `⌥⌘C` while the binding listens for
 * something else is worse than an unlabeled button, and the command palette
 * lists the very same strings.
 *
 * Matching is on `event.code`, not `event.key`: with Option held, macOS reports
 * the character the combination produces (`⌥⌘C` arrives as `Ç`), so a
 * `key`-based test silently never fires on the platform most of these
 * shortcuts are copied from.
 */

import { isMacPlatform, isWindowsPlatform } from '@/shared/lib/util/platform';

export interface KeyStroke {
  /** `KeyboardEvent.code`, e.g. `KeyC`, `ArrowUp`, `Slash`, `Digit1`. */
  code: string;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/** The subset of a keyboard event the matcher reads, so a test can fake one. */
export interface KeyboardEventLike {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface KeyBinding<Command extends string> {
  command: Command;
  /** What the palette and the tooltips call this command. */
  label: string;
  /** Chord on macOS. */
  mac: KeyStroke;
  /** Chord on Windows and Linux. */
  other: KeyStroke;
  /**
   * Windows-only override. VS Code redoes with `Ctrl+Y` on Windows while Linux
   * keeps `Ctrl+Shift+Z`, which one `other` stroke cannot express.
   */
  windows?: KeyStroke;
}

export function matchesStroke(stroke: KeyStroke, event: KeyboardEventLike): boolean {
  return (
    stroke.code === event.code &&
    Boolean(stroke.meta) === event.metaKey &&
    Boolean(stroke.ctrl) === event.ctrlKey &&
    Boolean(stroke.alt) === event.altKey &&
    Boolean(stroke.shift) === event.shiftKey
  );
}

/** The chord a binding resolves to on the current platform. */
export function strokeOf<C extends string>(binding: KeyBinding<C>, isMac: boolean): KeyStroke {
  if (isMac) return binding.mac;
  if (binding.windows && isWindowsPlatform()) return binding.windows;
  return binding.other;
}

/**
 * Codes whose printed name is not their `KeyboardEvent.code` suffix. Kept as a
 * table because the alternative — a chain of `if`s — is what makes a label
 * drift from the key it names.
 */
const KEY_LABEL_BY_CODE: Record<string, string> = {
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Del',
  Tab: 'Tab',
};

/** `⌥⌘C` on macOS, `Alt+C` elsewhere. */
export function describeStroke(stroke: KeyStroke, isMac: boolean): string {
  const parts: string[] = [];
  if (stroke.ctrl) parts.push(isMac ? '⌃' : 'Ctrl');
  if (stroke.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (stroke.shift) parts.push(isMac ? '⇧' : 'Shift');
  if (stroke.meta) parts.push(isMac ? '⌘' : 'Win');
  parts.push(printableKey(stroke.code));
  return isMac ? parts.join('') : parts.join('+');
}

/** The printed name of a physical key: `KeyC` → `C`, `Slash` → `/`, `ArrowUp` → `ArrowUp`. */
export function printableKey(code: string): string {
  if (KEY_LABEL_BY_CODE[code]) return KEY_LABEL_BY_CODE[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** The label a binding's shortcut gets in a tooltip or the palette. */
export function describeBinding<C extends string>(binding: KeyBinding<C>, isMac: boolean = isMacPlatform()): string {
  return describeStroke(strokeOf(binding, isMac), isMac);
}

/** The command `event` invokes, or null when no binding claims it. */
export function resolveBinding<C extends string>(
  bindings: readonly KeyBinding<C>[],
  event: KeyboardEventLike,
  isMac: boolean = isMacPlatform(),
): C | null {
  for (const binding of bindings) {
    if (matchesStroke(strokeOf(binding, isMac), event)) return binding.command;
  }
  return null;
}

/** The binding for a command, for a call site that knows what it wants to label. */
export function bindingFor<C extends string>(
  bindings: readonly KeyBinding<C>[],
  command: C,
): KeyBinding<C> | undefined {
  return bindings.find((binding) => binding.command === command);
}
