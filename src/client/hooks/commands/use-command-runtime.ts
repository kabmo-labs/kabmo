/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The app-wide command runtime: one dispatcher, the platform context keys, and
 * the user's stored overrides.
 *
 * Mounted once, at the app root. A second mount would install a second
 * listener, and every chord would run twice — the exact failure the old
 * per-surface listeners kept producing.
 */

import { useEffect } from 'preact/hooks';
import { installCommandDispatcher } from '@/client/lib/commands/dispatcher';
import { setCommandContext } from '@/client/lib/commands/context';
import { setUserKeybindings } from '@/client/lib/commands/keymap';
import { registerCommand } from '@/client/lib/commands/registry';
import { editorCommandTarget } from '@/client/lib/commands/editor-target';
import { openKeyBindingHelp, openPalette } from '@/client/lib/commands/overlays';
import { openEmptyWorkspace } from '@/client/lib/router/open-session';
import { UPDATE_CHECK_EVENT } from '@/shared/lib/updates/popup-state';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import { readUserKeybindings } from '@/shared/lib/commands/user-keybindings';
import { isMacPlatform, isWindowsPlatform } from '@kabmo-labs/kabmo-platform';

export function useCommandRuntime(): void {
  useEffect(() => installCommandDispatcher(), []);

  // The commands that exist in BOTH layouts. The layout-specific toggles are
  // registered by the layout that owns them; these are app-wide, so a phone that
  // opens the shortcut sheet still has a working palette command.
  //
  // `editor.run` is registered HERE, once, because the editor is not the only
  // frame that can be mounted: a split column mounts two `Editor` panes, and a
  // per-pane registration threw `command "editor.run" is already registered` on
  // the second one (measured: the dev overlay drew that error over the whole
  // viewport, so the split spec's next click never landed). The focused pane
  // publishes itself to `editorCommandTarget`, exactly as `workspace.saveFile`
  // already does.
  useEffect(() => {
    const disposers = [
      registerCommand('workspace.commandPalette', () => openPalette('commands')),
      registerCommand('workspace.quickOpen', () => openPalette('files')),
      registerCommand('workspace.keyBindings', () => openKeyBindingHelp()),
      // The sidebar's primary action, reachable from the native File menu and
      // the palette. It clears the routing state rather than minting a pending
      // chat — see `SessionsView.handleNewSession`.
      registerCommand('workspace.newSession', () => {
        openEmptyWorkspace();
      }),
      // The native App menu's "Check for Updates…" asks the page, because the
      // check and its verdict live in `useUpdates` on whichever sidebar is
      // mounted. A second copy of the request here would be a second source of
      // truth for the same state.
      registerCommand('workspace.checkUpdates', () => {
        window.dispatchEvent(new CustomEvent(UPDATE_CHECK_EVENT));
      }),
      registerCommand('workspace.saveFile', () => editorCommandTarget()?.saveNow()),
      registerCommand('editor.run', (args) => {
        const command = (args as { command?: EditorCommand } | undefined)?.command;
        if (command) editorCommandTarget()?.runCommand(command);
      }),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, []);

  useEffect(() => {
    setCommandContext('isMac', isMacPlatform());
    setCommandContext('isWindows', isWindowsPlatform());
    setCommandContext('isLinux', !isMacPlatform() && !isWindowsPlatform());
    setUserKeybindings(readUserKeybindings());
  }, []);
}
