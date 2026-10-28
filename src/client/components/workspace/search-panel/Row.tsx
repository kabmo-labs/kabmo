/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One search hit.
 *
 * Two things happen here that the panel's own state does not own:
 *
 * - **The matched text is highlighted**, using the character ranges the server
 *   derived from ripgrep's own submatches. Those ranges ride the same
 *   `find-match` markup the editor's find bar paints, so a hit looks the same
 *   wherever it is read, and the highlight cannot drift from the text it
 *   belongs to.
 * - **With a replacement typed, the row previews the line**, the old text struck
 *   through and the new text beside it, the way VS Code's search view does. The
 *   split is `replacePreviewSegments`' job; this file only paints it.
 *
 * The component is memoized, and the highlight goes through
 * `highlightSearchLine`'s bounded cache, because the list can hold tens of
 * thousands of rows: without either, one scroll re-tokenized every mounted line
 * through Shiki (measured: 34 s of blocked main thread for a five-step scroll
 * over 19,376 rows). `onOpen` is therefore expected to be a stable callback —
 * `SearchPanel` hands it a `useCallback` for exactly that reason.
 */

import { memo } from 'preact/compat';

import { highlightSearchLine } from '@/shared/lib/code/highlight-cache';
import { getLanguageFromPath } from '@/shared/lib/code/language';
import { replacePreviewSegments } from '@/shared/lib/fs/search-row';
import type { SearchResultItem } from '@/shared/types/fs';

interface SearchRowProps {
  file: string;
  result: SearchResultItem;
  replacement: string;
  /** The replace field holds text, so the row previews the rewritten line. */
  showReplacePreview: boolean;
  onOpen: (result: SearchResultItem) => void;
}

function SearchRowView({ file, result, replacement, showReplacePreview, onOpen }: SearchRowProps) {
  const ranges = result.ranges ?? [];
  const preview = showReplacePreview && replacement.length > 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(result)}
      className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left hover:bg-ink/5 cursor-pointer"
      title={`Open ${file}:${result.line}`}
    >
      <span className="w-6 flex-shrink-0 text-right font-mono text-ink/40">{result.line}</span>
      {preview ? (
        <span className="min-w-0 truncate font-mono text-ink">
          {replacePreviewSegments(result.content, ranges, replacement).map((segment, index) =>
            segment.kind === 'plain' ? (
              <span key={index}>{segment.text}</span>
            ) : segment.kind === 'removed' ? (
              <del key={index} className="search-replace-old">
                {segment.text}
              </del>
            ) : (
              <ins key={index} className="search-replace-new">
                {segment.text}
              </ins>
            ),
          )}
        </span>
      ) : (
        <span
          className="min-w-0 truncate font-mono text-ink"
          // The markup comes from Shiki and the mark splicer, which escape
          // every character of the file's own text on the way in.
          dangerouslySetInnerHTML={{
            __html: highlightSearchLine(result.content, getLanguageFromPath(file), ranges),
          }}
        />
      )}
    </button>
  );
}

export const SearchRow = memo(SearchRowView);
