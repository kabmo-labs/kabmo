/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The collapsed "N files changed" row above a run's footer.
 *
 * The list is the agent's own change journal, bucketed into the run by
 * `bucketChangesByRun`; clicking a file opens a diff tab whose two sides are
 * the journal's before/after snapshots, not the worktree. That is the point:
 * another agent or the user may have edited the file since, and the reader
 * asked what THIS run did.
 */

import { useState } from 'preact/hooks';
import { ChevronDown, ChevronRight } from 'lucide-preact';
import type { ChangedFile } from '@/shared/types';

const STATUS_LABEL: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
};

const STATUS_CLASS: Record<ChangedFile['status'], string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-error',
};

interface ChangedFilesSummaryProps {
  files: ChangedFile[];
  sessionId: string;
  /** Run window, epoch ms — the range the diff tab reads. */
  from: number;
  to: number;
}

export function ChangedFilesSummary({
  files,
  sessionId,
  from,
  to,
}: ChangedFilesSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const label = `${files.length} file${files.length === 1 ? '' : 's'} changed`;

  return (
    <div className="rounded-md border border-ink/10 bg-paper/60">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-ink/70 hover:text-ink transition-colors cursor-pointer"
      >
        {expanded
          ? <ChevronDown size={12} className="shrink-0" />
          : <ChevronRight size={12} className="shrink-0" />}
        <span className="font-medium">{label}</span>
      </button>
      {expanded && (
        <ul className="border-t border-ink/10 py-0.5">
          {files.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                onClick={() => openJournalDiff(file, sessionId, from, to)}
                className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[11px] hover:bg-ink/[0.04] transition-colors cursor-pointer"
                title={file.path}
              >
                <span className={`w-3 shrink-0 font-mono font-semibold ${STATUS_CLASS[file.status]}`}>
                  {STATUS_LABEL[file.status]}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-ink/80">{file.displayPath}</span>
                {file.agent !== 'Main' && (
                  <span className="shrink-0 text-[10px] text-ink/40">{file.agent}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Open the journal diff tab for one file. The desktop and phone layouts both
 *  listen for `omp:open-diff`; the journal fields are what make it a journal
 *  read rather than a worktree read. */
function openJournalDiff(file: ChangedFile, sessionId: string, from: number, to: number): void {
  window.dispatchEvent(new CustomEvent('omp:open-diff', {
    detail: {
      file: file.displayPath,
      status: STATUS_LABEL[file.status],
      source: 'journal',
      journal: { sessionId, path: file.path, from, to },
    },
  }));
}
