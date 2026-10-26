/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor column with nothing open.
 *
 * Its own component for the per-file ceiling, and because the sentence is a promise the
 * panel has to keep: the column is open (the user toggled it) and there is no file in it,
 * so the only thing to say is how to put one there.
 */

import { FileIcon } from '@/client/components/common/file-icon';

export function EmptyEditor({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col h-full bg-canvas items-center justify-center text-ink/40 ${className}`}>
      <FileIcon name="placeholder.txt" size={48} className="mb-4 opacity-20" />
      <p className="font-mono text-sm">Select a file to open</p>
    </div>
  );
}
