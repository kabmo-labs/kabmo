/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's row LABEL: the disclosure glyph, the icon, the name and the
 * two git marks.
 *
 * Split from `TreeItem.tsx` because it is the row's leaf markup and has no
 * behaviour of its own — every fact it draws is derived by the row and handed
 * in, so the split costs no prop drilling and keeps the row component under the
 * repository's line ceiling.
 */

import { ChevronDown, ChevronRight } from 'lucide-preact';
import { FileIcon } from '@/client/components/common/file-icon';
import type { FolderGitStatusInfo } from '@/shared/lib/fs/git-status';

interface TreeRowLabelProps {
  name: string;
  path: string;
  isFolder: boolean;
  isOpen: boolean;
  /** Git-ignored entries render faded rather than being hidden. */
  ignored: boolean;
  /** This file's own change, when it has one. */
  gitStatus: { colorClass: string; label: string; charStatus: string } | null;
  /** The roll-up a folder wears instead: one dot, its tone from the changes. */
  folderStatus: FolderGitStatusInfo | null | undefined;
}

export function TreeRowLabel({ name, path, isFolder, isOpen, ignored, gitStatus, folderStatus }: TreeRowLabelProps) {
  const tone = gitStatus ? gitStatus.colorClass : folderStatus ? folderStatus.colorClass : ignored ? 'text-ink/40' : '';
  return (
    <>
      {isFolder ? (
        isOpen ? <ChevronDown size={12} className="flex-shrink-0 text-ink/40" /> : <ChevronRight size={12} className="flex-shrink-0 text-ink/40" />
      ) : (
        <span className="w-3 flex-shrink-0"></span>
      )}

      <FileIcon name={name} isFolder={isFolder} isOpen={isOpen} size={12} className={`flex-shrink-0${ignored ? ' opacity-40' : ''}`} />
      <span className={`truncate min-w-0 flex-1 ${tone}`} title={ignored ? `${path} — git-ignored` : undefined}>
        {name}
      </span>

      {gitStatus && (
        <span
          className={`font-mono text-[10px] font-bold px-1 rounded flex-shrink-0 ${gitStatus.colorClass}`}
          title={`Git: ${gitStatus.label}`}
        >
          {gitStatus.charStatus}
        </span>
      )}

      {folderStatus && (
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            folderStatus.hasDeleted ? 'bg-error' :
            folderStatus.hasModified || folderStatus.hasStaged ? 'bg-info' : 'bg-success'
          }`}
          title={`${folderStatus.count} changed file${folderStatus.count > 1 ? 's' : ''}`}
        />
      )}
    </>
  );
}
