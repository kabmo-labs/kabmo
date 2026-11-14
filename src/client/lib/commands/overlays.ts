/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two overlays a command can open: the palette and the shortcut sheet.
 *
 * They live in a store rather than in a layout's state because a command runs
 * from anywhere — a chord, a footer button, a plugin — and the surface that
 * draws the overlay is the app root. The palette captures the context it opened
 * WITH: opening it moves focus to its input, so a live `editorTextFocus` would
 * be false by the time the list is drawn and every editor command would vanish.
 */

import type { CommandContext } from '@/shared/lib/commands/types';
import { commandContext, setCommandContext } from '@/client/lib/commands/context';

export type PaletteMode = 'commands' | 'files';

export interface PaletteState {
  open: boolean;
  mode: PaletteMode;
  /** The context at the moment it opened. */
  context: CommandContext;
}

interface OverlayState {
  palette: PaletteState;
  help: boolean;
  listeners: Set<() => void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoCommandOverlays: OverlayState | undefined;
}

function state(): OverlayState {
  return (globalThis.__kabmoCommandOverlays ??= {
    palette: { open: false, mode: 'commands', context: {} },
    help: false,
    listeners: new Set(),
  });
}

function publish(): void {
  for (const listener of [...state().listeners]) listener();
}

export function openPalette(mode: PaletteMode = 'commands'): void {
  state().palette = { open: true, mode, context: commandContext() };
  setCommandContext('paletteOpen', true);
  publish();
}

export function closePalette(): void {
  if (!state().palette.open) return;
  state().palette = { ...state().palette, open: false };
  setCommandContext('paletteOpen', false);
  publish();
}

export function paletteState(): PaletteState {
  return state().palette;
}

export function openKeyBindingHelp(): void {
  if (state().help) return;
  state().help = true;
  publish();
}

export function closeKeyBindingHelp(): void {
  if (!state().help) return;
  state().help = false;
  publish();
}

export function keyBindingHelpOpen(): boolean {
  return state().help;
}

export function subscribeOverlays(listener: () => void): () => void {
  state().listeners.add(listener);
  return () => state().listeners.delete(listener);
}
