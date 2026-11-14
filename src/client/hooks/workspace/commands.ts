/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The workspace commands, registered once for the desktop layout.
 *
 * This replaces the old `useWorkspaceKeybindings`, which resolved a chord and
 * then dispatched through an if-chain. The commands are now the same rows the
 * palette lists and the settings page edits, so a chord cannot exist without a
 * command and a command cannot exist without a row.
 *
 * `⌘S` is no longer skipped here: it is `workspace.saveFile`, and the editor
 * publishes the focused pane's `saveNow` through `editorCommandTarget`. The old
 * skip existed because two listeners both claimed the chord.
 */

import { useEffect, useRef } from 'preact/hooks';
import { registerCommand } from '@/client/lib/commands/registry';
import { useCommandContext } from '@/client/hooks/commands/use-command-context';

export interface WorkspaceCommandTargets {
  showEditor: boolean;
  /** Whether the editor column has anything to open on to. */
  editorHasContent: boolean;
  toggleSidebar: () => void;
  toggleEditor: () => void;
  toggleRightPanel: () => void;
  openSettings: () => void;
}

export function useWorkspaceCommands(targets: WorkspaceCommandTargets): void {
  const latest = useRef(targets);
  latest.current = targets;

  useCommandContext('editorPanelAvailable', targets.showEditor || targets.editorHasContent);
  useCommandContext('editorPanelVisible', targets.showEditor);

  useEffect(() => {
    const disposers = [
      registerCommand('workspace.toggleSidebar', () => latest.current.toggleSidebar()),
      registerCommand('workspace.toggleEditorPanel', () => latest.current.toggleEditor()),
      registerCommand('workspace.toggleRightPanel', () => latest.current.toggleRightPanel()),
      registerCommand('workspace.openSettings', () => latest.current.openSettings()),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, []);
}
