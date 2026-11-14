/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The active editor's command target.
 *
 * The editor owns `saveNow` and its own `runCommand`, and both are per-pane
 * state. A global command cannot import them, so the focused pane publishes
 * them here and the registry's `workspace.saveFile` / `editor.run` call through.
 *
 * The target is set on FOCUS, not on mount: a split column mounts two panes,
 * and "the last one mounted" is not the one the user is typing in.
 */

import type { EditorCommand } from '@/shared/lib/code/editor/keymap';

export interface EditorCommandTarget {
  saveNow: () => void;
  runCommand: (command: EditorCommand) => void;
}

let current: EditorCommandTarget | null = null;

/** Publish a pane's target. Returns a disposer that only clears its own. */
export function setEditorCommandTarget(target: EditorCommandTarget): () => void {
  current = target;
  return () => {
    if (current === target) current = null;
  };
}

export function editorCommandTarget(): EditorCommandTarget | null {
  return current;
}
