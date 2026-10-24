/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One file's matches inside a `grep`/`glob` card.
 *
 * Two costs live here, and both were paid on every expand of the card:
 *
 * 1. **The tokenizer.** Every file's lines were tokenized in the parent's render,
 *    in one synchronous pass — the profile of a `grep` expand put 40% of its
 *    long task inside Shiki's regex engine. The highlight is deferred per FILE
 *    (`useDeferredHighlightLines`), so the card paints the matches first and the
 *    colour follows on an idle slice.
 * 2. **The row count.** `MAX_OUTPUT_LINES` caps the whole output, not one file,
 *    so a single 900-line file group mounted 900 rows inside a `max-h-80`
 *    scroller that shows ~14. The window is per file now, opened on the first
 *    lines (a match group is read from its top) with the rest one click away.
 */

import { useMemo, useState } from 'preact/hooks';
import { ChevronRight, FileText } from 'lucide-preact';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { useDeferredHighlightLines } from '@/client/hooks/code/deferred-highlight';

/** Rows mounted for one file before the reader asks for the rest. */
export const MAX_MATCH_LINES_PER_FILE = 60;

interface MatchRow {
  lineNum: number;
  text: string;
  isMatch: boolean;
}

export interface FileMatchesProps {
  path: string;
  lines: MatchRow[];
  matchCount: number;
  isGlobList: boolean;
}

export function FileMatches({ path, lines, matchCount, isGlobList }: FileMatchesProps) {
  const [showAll, setShowAll] = useState(false);
  const visible = useMemo(
    () => (showAll ? lines : lines.slice(0, MAX_MATCH_LINES_PER_FILE)),
    [lines, showAll],
  );
  const hidden = lines.length - visible.length;

  const lang = getLanguageFromPath(path);
  const highlighted = useDeferredHighlightLines(
    useMemo(() => visible.map((line) => line.text).join('\n'), [visible]),
    lang,
  );

  return (
    <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
      {/* File Header */}
      <div className="flex items-center justify-between border-b border-ink/6 bg-canvas/40 px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText size={12} className="shrink-0 text-ink/40" />
          <span className="truncate font-mono text-[11px] font-medium text-ink/85">{path}</span>
        </div>
        {matchCount > 0 && !isGlobList && (
          <span className="ml-2 shrink-0 rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[9.5px] text-ink/50">
            {matchCount} {matchCount === 1 ? 'hit' : 'hits'}
          </span>
        )}
      </div>

      {/* Code Lines inside file — satu scroll horizontal per file, semua row selebar konten terlebar */}
      {visible.length > 0 && (
        <div className="overflow-x-auto overscroll-x-contain">
          <div className="w-max min-w-full divide-y divide-ink/[0.04] font-mono text-[11px] leading-relaxed select-text">
            {visible.map((line, lineIdx) => (
              <div
                key={lineIdx}
                className={`flex items-start gap-2.5 px-2.5 py-1 transition-colors ${
                  line.isMatch ? 'bg-warning/[0.08] text-ink' : 'bg-paper text-ink/60 hover:bg-ink/[0.02]'
                }`}
              >
                <span
                  className={`sticky left-0 z-10 flex w-9 shrink-0 select-none items-center justify-end bg-inherit font-mono text-[10px] ${
                    line.isMatch ? 'font-semibold text-warning-dark dark:text-warning' : 'text-ink/30'
                  }`}
                >
                  {line.isMatch && <ChevronRight size={10} className="mr-0.5 text-warning" />}
                  {line.lineNum}
                </span>
                <pre
                  className="shiki whitespace-pre font-mono"
                  dangerouslySetInnerHTML={{ __html: highlighted[lineIdx] || '&nbsp;' }}
                />
              </div>
            ))}
          </div>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full border-t border-ink/6 bg-canvas/40 px-2.5 py-1 text-left font-mono text-[10px] text-ink/55 transition-colors hover:bg-ink/5 hover:text-ink"
            >
              … {hidden} more {hidden === 1 ? 'line' : 'lines'} — show all {lines.length}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
