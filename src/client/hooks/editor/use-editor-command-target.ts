/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Publish the focused editor pane as the target of `workspace.saveFile` and
 * `editor.run`.
 *
 * Set on FOCUS, not on mount: a split column mounts two panes, and the last one
 * mounted is not necessarily the one the user is typing in.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import { setEditorCommandTarget, type EditorCommandTarget } from '@/client/lib/commands/editor-target';

export interface EditorCommandTargetSource {
  saveNow: () => void;
  runCommand: (command: EditorCommand) => void;
}

export function useEditorCommandTarget(source: EditorCommandTargetSource): { onFocusCapture: () => void } {
  const latest = useRef(source);
  latest.current = source;

  const target = useRef<EditorCommandTarget | null>(null);
  if (!target.current) {
    target.current = {
      saveNow: () => latest.current.saveNow(),
      runCommand: (command) => latest.current.runCommand(command),
    };
  }

  useEffect(() => {
    const published = target.current;
    if (!published) return;
    return setEditorCommandTarget(published);
  }, []);

  const onFocusCapture = useCallback(() => {
    if (target.current) setEditorCommandTarget(target.current);
  }, []);

  return { onFocusCapture };
}
