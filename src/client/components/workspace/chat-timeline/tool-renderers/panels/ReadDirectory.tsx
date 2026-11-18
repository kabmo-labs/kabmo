/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A `read` of a directory, as the tree omp printed.
 *
 * Split out of `Read` for the file-size ceiling, not for reuse: the panel is
 * one card and its branches are exclusive. The props are exactly what the
 * listing needs — the rows already sliced to the tail, how many were dropped,
 * and omp's own trailing notice — so the panel keeps its line-budget policy and
 * this component only draws.
 */

import { FileText, Folder, Info } from 'lucide-preact';
import type { DirEntry } from '@/shared/lib/code/parser';

interface ReadDirectoryProps {
  /** The rows to draw, tail-limited by the panel's line budget. */
  entries: DirEntry[];
  /** How many earlier rows the limit dropped. */
  skipped: number;
  /** omp's own footer line, when the listing carried one. */
  notice?: string;
}

export function ReadDirectory({ entries, skipped, notice }: ReadDirectoryProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
      {skipped > 0 && (
        <div className="flex items-center gap-1.5 border-b border-ink/8 bg-canvas/60 px-3 py-1.5 text-[10px] text-ink/50">
          <Info size={11} className="shrink-0" />
          <span>… {skipped} earlier entries hidden</span>
        </div>
      )}
      <div className="max-h-72 divide-y divide-ink/[0.04] overflow-y-auto font-mono text-[11px]">
        {entries.map((entry, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-ink/[0.02]"
            style={{ paddingLeft: `${Math.max(12, (entry.indent + 1) * 16)}px` }}
          >
            {entry.isDir ? (
              <Folder size={12} className="shrink-0 text-ink/60" />
            ) : (
              <FileText size={12} className="shrink-0 text-ink/40" />
            )}
            <span
              className={`min-w-0 flex-1 truncate ${entry.isDir ? 'font-semibold text-ink' : 'text-ink/80'}`}
            >
              {entry.name}
              {entry.isDir && '/'}
            </span>
            {entry.size && <span className="shrink-0 font-mono text-[10px] text-ink/40">{entry.size}</span>}
            {entry.time && (
              <span className="shrink-0 rounded bg-ink/5 px-1 py-0.2 font-mono text-[10px] text-ink/45">
                {entry.time}
              </span>
            )}
          </div>
        ))}
      </div>
      {notice && (
        <div className="flex items-center gap-1.5 border-t border-ink/8 bg-canvas/60 px-3 py-1.5 text-[10px] text-ink/50">
          <Info size={11} className="shrink-0" />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}
