/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The workspace shortcuts, bound once for the desktop layout.
 *
 * Extracted from the layout because it is a self-contained decision — a chord
 * mapped to one of four column/settings toggles — that has nothing to do with
 * what the layout renders. `⌘S` is deliberately absent: the editor owns it, and
 * binding it twice would save the file twice.
 */

import { useWindowEvent } from '@/client/hooks/ui/window-event';
import { resolveBinding } from '@/shared/lib/ui/key-binding';
import { WORKSPACE_KEY_BINDINGS } from '@/shared/lib/workspace/keymap';

export interface WorkspaceKeybindingTargets {
  showEditor: boolean;
  /** Whether the editor column has anything to open on to. */
  editorHasContent: boolean;
  toggleSidebar: () => void;
  toggleEditor: () => void;
  toggleRightPanel: () => void;
  openSettings: () => void;
}

export function useWorkspaceKeybindings(targets: WorkspaceKeybindingTargets): void {
  useWindowEvent('keydown', (event) => {
    const command = resolveBinding(WORKSPACE_KEY_BINDINGS, event);
    if (!command) return;
    if (command === 'saveFile') return;
    // The toggle is the only way to REACH a takeover while the column is
    // closed, since the rail lives inside the column: with nothing to open on
    // to there would be no column at all.
    if (command === 'toggleEditorPanel' && !targets.showEditor && !targets.editorHasContent) return;
    event.preventDefault();
    if (command === 'toggleSidebar') targets.toggleSidebar();
    else if (command === 'toggleEditorPanel') targets.toggleEditor();
    else if (command === 'toggleRightPanel') targets.toggleRightPanel();
    else if (command === 'openSettings') targets.openSettings();
  });
}
