/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The built-in commands, as data.
 *
 * This table is the single source for the palette, the settings table, the
 * cheatsheet and every tooltip that names a chord. A command that is not here
 * cannot be listed, and a chord that is not here cannot be shown — which is the
 * property the old per-surface tables lacked.
 *
 * Editor TEXT commands are deliberately absent: they belong to CodeMirror's
 * keymap and are listed by the palette through the editor's own table
 * (`shared/lib/code/editor/keymap.ts`), so a chord is never bound twice.
 */

import type { CommandMeta } from '@/shared/lib/commands/types';

export const BUILTIN_COMMANDS: readonly CommandMeta[] = [
  {
    id: 'workspace.commandPalette',
    title: 'Show All Commands',
    category: 'Navigation',
    keywords: ['palette', 'command', 'run', 'action'],
    defaultKey: {
      mac: [{ code: 'KeyP', meta: true, shift: true }],
      other: [{ code: 'KeyP', ctrl: true, shift: true }],
    },
  },
  {
    id: 'workspace.quickOpen',
    title: 'Go to File…',
    category: 'Navigation',
    keywords: ['file', 'open', 'quick', 'jump', 'path'],
    defaultKey: {
      mac: [{ code: 'KeyP', meta: true }],
      other: [{ code: 'KeyP', ctrl: true }],
    },
  },
  {
    id: 'workspace.keyBindings',
    title: 'Show Keyboard Shortcuts',
    category: 'Navigation',
    keywords: ['keymap', 'shortcut', 'help', 'cheatsheet', 'keys'],
    defaultKey: {
      mac: [
        { code: 'KeyK', meta: true },
        { code: 'KeyS', meta: true },
      ],
      other: [
        { code: 'KeyK', ctrl: true },
        { code: 'KeyS', ctrl: true },
      ],
    },
  },
  {
    id: 'workspace.toggleSidebar',
    title: 'Toggle Sidebar',
    category: 'View',
    keywords: ['panel', 'left', 'sessions'],
    defaultKey: {
      mac: [{ code: 'KeyB', meta: true }],
      other: [{ code: 'KeyB', ctrl: true }],
    },
  },
  {
    id: 'workspace.toggleEditorPanel',
    title: 'Toggle Editor Panel',
    category: 'View',
    keywords: ['editor', 'code', 'column'],
    when: 'editorPanelAvailable',
    defaultKey: {
      mac: [{ code: 'KeyJ', meta: true }],
      other: [{ code: 'KeyJ', ctrl: true }],
    },
  },
  {
    id: 'workspace.toggleRightPanel',
    title: 'Toggle Right Panel',
    category: 'View',
    keywords: ['panel', 'right', 'files', 'git'],
    defaultKey: {
      mac: [{ code: 'KeyJ', meta: true, alt: true }],
      other: [{ code: 'KeyJ', ctrl: true, alt: true }],
    },
  },
  {
    id: 'workspace.openSettings',
    title: 'Open Settings',
    category: 'Workspace',
    keywords: ['preferences', 'config'],
    defaultKey: {
      mac: [{ code: 'Comma', meta: true }],
      other: [{ code: 'Comma', ctrl: true }],
    },
  },
  {
    id: 'workspace.saveFile',
    title: 'Save File',
    category: 'Editor',
    keywords: ['write', 'disk'],
    defaultKey: {
      mac: [{ code: 'KeyS', meta: true }],
      other: [{ code: 'KeyS', ctrl: true }],
    },
  },
];

/** The command a chord opens the palette with, named once. */
export const COMMAND_PALETTE_ID = 'workspace.commandPalette';
export const QUICK_OPEN_ID = 'workspace.quickOpen';
export const KEY_BINDINGS_ID = 'workspace.keyBindings';
