/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor column with nothing open.
 *
 * Its own component for the per-file ceiling, and because the sentence is a promise the
 * panel has to keep: the column is open (the user toggled it) and there is no file in it,
 * so the only thing to say is how to put one there.
 */

import { FileIcon } from '@/client/components/common/file-icon';
import { EditorHideButton } from '@/client/components/workspace/editor/EditorHideButton';

export function EmptyEditor({ className = '', onHide }: { className?: string; onHide?: () => void }) {
  return (
    <div className={`relative flex flex-col h-full bg-canvas items-center justify-center text-muted ${className}`}>
      {/* The column's own switch is on every state of the column, including
          this one: a column that is open with nothing in it is still a column
          the user may want out of the way. */}
      {onHide && (
        <div className="absolute top-0 right-0 flex items-center">
          <EditorHideButton onHide={onHide} />
        </div>
      )}
      <FileIcon name="placeholder.txt" size={48} className="mb-4 opacity-20" />
      <p className="font-mono text-sm">Select a file to open</p>
    </div>
  );
}
