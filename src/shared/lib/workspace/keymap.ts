/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The workspace's own shortcuts — the ones that belong to a PANEL rather than
 * to the text inside it. Kept in a table beside the editor's keymap for the
 * same reason: the panel toggles carry their chord in a tooltip, and a tooltip
 * that names a key nobody listens for is a lie.
 *
 * These are deliberately few. A global table is where a shortcut goes to
 * collide with the browser's own (⌘W closes a tab, ⌘T opens one, ⌘N opens a
 * window) or with a text field the user is typing in — so only chords that are
 * inert in a text field and unambiguous in this app are bound here.
 */

import type { KeyBinding } from '@/shared/lib/ui/key-binding';

export type WorkspaceCommand = 'toggleEditorPanel' | 'toggleRightPanel' | 'toggleSidebar' | 'openSettings' | 'saveFile';

export const WORKSPACE_KEY_BINDINGS: readonly KeyBinding<WorkspaceCommand>[] = [
  // ⌘B / ⌘J are VS Code's own panel toggles.
  { command: 'toggleSidebar', label: 'Toggle sidebar', mac: { code: 'KeyB', meta: true }, other: { code: 'KeyB', ctrl: true } },
  { command: 'toggleEditorPanel', label: 'Toggle editor panel', mac: { code: 'KeyJ', meta: true }, other: { code: 'KeyJ', ctrl: true } },
  { command: 'toggleRightPanel', label: 'Toggle right panel', mac: { code: 'KeyJ', meta: true, alt: true }, other: { code: 'KeyJ', ctrl: true, alt: true } },
  // ⌘, is the platform's own settings chord (the app already binds it).
  { command: 'openSettings', label: 'Open settings', mac: { code: 'Comma', meta: true }, other: { code: 'Comma', ctrl: true } },
  { command: 'saveFile', label: 'Save file', mac: { code: 'KeyS', meta: true }, other: { code: 'KeyS', ctrl: true } },
];
