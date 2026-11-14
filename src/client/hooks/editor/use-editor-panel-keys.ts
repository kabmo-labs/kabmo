/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor panel's own keys: Escape for the find bar, `⌘⇧T` for a closed tab,
 * and the find-bar commands.
 *
 * Everything else is a GLOBAL command now. `⌘P`, `⌘⇧P` and `⌘S` used to be
 * hardcoded here, which is why `⌘S` had to be skipped in the workspace table to
 * avoid saving twice. The panel keeps only the keys that need its own state:
 * the find bar's Escape, and a reopen that must not consume the chord when the
 * stack is empty.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import { EDITOR_KEY_BINDINGS, isFindBarCommand, type EditorCommand } from '@/shared/lib/code/editor/keymap';
import { resolveBinding } from '@/shared/lib/ui/key-binding';
import { registerCommand } from '@/client/lib/commands/registry';
import type { EditorFindState } from '@/client/hooks/editor/use-editor-find';

export interface UseEditorPanelKeysOptions {
  find: EditorFindState;
  runCommand: (command: EditorCommand) => void;
  reopenClosed?: () => boolean;
}

export interface EditorPanelKeys {
  onKeyDownCapture: (event: TargetedKeyboardEvent<HTMLDivElement>) => void;
}

export function useEditorPanelKeys({ find, runCommand, reopenClosed }: UseEditorPanelKeysOptions): EditorPanelKeys {
  // The handler is rebuilt every render (it reads live find state), so the ref is
  // what keeps the window listener attached once.
  const findRef = useRef(find);
  findRef.current = find;
  const runRef = useRef(runCommand);
  runRef.current = runCommand;
  const reopenRef = useRef(reopenClosed);
  reopenRef.current = reopenClosed;

  // The palette's one adapter into CodeMirror: a row runs `editor.run` with the
  // command as its argument, and this is the only place that knows how.
  useEffect(
    () =>
      registerCommand('editor.run', (args) => {
        const command = (args as { command?: EditorCommand } | undefined)?.command;
        if (command) runRef.current(command);
      }),
    [],
  );

  const onKeyDownCapture = useCallback((event: TargetedKeyboardEvent<HTMLDivElement>) => {
    const current = findRef.current;

    if (event.key === 'Escape') {
      if (!current.open) return;
      event.preventDefault();
      event.stopPropagation();
      current.close();
      return;
    }

    // ⌘⇧T restores the last closed tab. Only consumed when there IS something to
    // restore, so an empty stack leaves the key to the browser rather than
    // swallowing it.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyT') {
      if (reopenRef.current?.()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    // While the bar is open, an unmodified key in one of ITS fields belongs to
    // the field — but F3 and the ⌘-chords below still dispatch, so stepping to
    // the next match from inside the find field works.
    const command = resolveBinding(EDITOR_KEY_BINDINGS, event);
    if (!command || !isFindBarCommand(command)) return;
    event.preventDefault();
    event.stopPropagation();
    runRef.current(command);
  }, []);

  return { onKeyDownCapture };
}
