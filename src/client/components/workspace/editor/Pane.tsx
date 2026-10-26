/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One pane of the editor column: the strip, the notices, the body, the Save As dialog and
 * the two confirmations.
 *
 * Extracted so the SPLIT can render the same thing twice. A second hand-written pane would
 * be a second list of what a pane contains, and the two would drift the moment one gained a
 * notice — which is the class of bug the split must not introduce.
 *
 * It takes DATA (the file, the buffer, the conflict) and builds its own slots, so the panel
 * only decides which pane it is drawing. That is also what keeps `index.tsx` under the
 * repository's line ceiling as the column grew a split.
 *
 * ## A split pane draws no strip
 *
 * The tab order and the active tab belong to the LEFT pane, so a second strip would be a
 * second owner of both.
 */

import type { ComponentChildren } from 'preact';

import { EditorNotices } from '@/client/components/workspace/editor/Notices';
import { SaveAsModal } from '@/client/components/workspace/editor/SaveAsModal';
import { EditorDialogs } from '@/client/components/workspace/editor/Dialogs';
import type { DiskChange } from '@/client/hooks/editor/use-external-change';
import type { CloseGuard } from '@/client/hooks/editor/use-close-guard';
import type { UseFileEditorResult } from '@/client/hooks/editor/file-editor-types';
import type { WriteConflict } from '@/client/hooks/editor/use-write-conflict';
import type { OpenedFile } from '@/shared/types/fs';

interface EditorPaneProps {
  className?: string;
  isMaximized: boolean;
  onKeyDownCapture: (event: never) => void;
  asSplitPane: boolean;
  /** The tab strip. Dropped in a split pane. */
  tabs: ComponentChildren;
  /** The active file and the buffer it is drawn from. */
  activeFile: OpenedFile | undefined;
  editor: UseFileEditorResult;
  externalChange: DiskChange | null;
  conflict: WriteConflict | null;
  onReload: () => void;
  onKeepMine: () => void;
  /** The document area (toolbar + surface), already assembled. */
  body: ComponentChildren;
  /** Save As is open, and the callback that closes it after a write. */
  saveAsOpen: boolean;
  onSaveAsClose: () => void;
  onSavedAs: (path: string) => void;
  closeGuard: CloseGuard;
}

export function EditorPane({
  className = '',
  isMaximized,
  onKeyDownCapture,
  asSplitPane,
  tabs,
  activeFile,
  editor,
  externalChange,
  conflict,
  onReload,
  onKeepMine,
  body,
  saveAsOpen,
  onSaveAsClose,
  onSavedAs,
  closeGuard,
}: EditorPaneProps) {
  const containerClass = isMaximized
    ? 'fixed inset-0 z-50 flex flex-col bg-canvas'
    : `flex flex-col h-full bg-canvas ${className}`;

  return (
    <div className={containerClass} onKeyDownCapture={onKeyDownCapture}>
      {asSplitPane ? null : tabs}

      <EditorNotices
        activeFile={activeFile}
        externalChange={externalChange}
        conflict={conflict}
        onReload={onReload}
        onKeepMine={onKeepMine}
      />

      {body}

      {/* Save As needs the BUFFER, so it is built here from the editor state rather than
          handed in as a slot. */}
      {saveAsOpen && activeFile ? (
        <SaveAsModal
          fileName={activeFile.name}
          filePath={activeFile.path}
          content={editor.content}
          eol={editor.eol}
          root={activeFile.root}
          repo={activeFile.repo}
          onSaved={({ path }) => onSavedAs(path)}
          onClose={onSaveAsClose}
        />
      ) : null}

      <EditorDialogs
        closeGuard={closeGuard}
        activeFile={activeFile}
        saveMissingConfirm={editor.saveMissingConfirm}
        onCancelSaveMissing={editor.cancelSaveMissing}
        onConfirmSaveMissing={editor.confirmSaveMissing}
      />
    </div>
  );
}
