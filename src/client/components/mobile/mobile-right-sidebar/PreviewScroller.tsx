/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone editor's "a document, not an editor" surface.
 *
 * Four states share one scroller, and that is the point of putting them in one
 * component: a file still loading, one refused for its KIND, one whose read
 * failed, and a rendered markdown page are all drawn by something that scrolls
 * itself — and the outline's table of contents finds its headings inside THIS
 * element. Two containers would mean two refs, and the contents jump would work
 * on one state and silently do nothing on the other.
 *
 * Extracted from `FullEditor` for the per-file line ceiling; it owns no state,
 * which is what keeps the boundary honest.
 */

import { AlertTriangle, FileX, Loader2 } from 'lucide-preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';

interface PreviewScrollerProps {
  fileName: string;
  content: string;
  /** Where the document lives, so its relative links and images resolve. */
  path: string;
  root?: string;
  repo?: string;
  fontSize: number;
  /** The scroll-restore binding's ref, which the contents jump shares. */
  scrollRef: (element: HTMLElement | null) => void;
  onScroll: () => void;
  isLoading: boolean;
  /** Why this file cannot be opened here, when its kind is unsupported. */
  unsupported: string | null | undefined;
  /** The read's failure message, when the bytes could not be fetched. */
  loadError: string | null | undefined;
}

export function PreviewScroller({
  fileName,
  content,
  path,
  root,
  repo,
  fontSize,
  scrollRef,
  onScroll,
  isLoading,
  unsupported,
  loadError,
}: PreviewScrollerProps) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      // The same testid the code surface and the desktop preview carry: one name
      // for "the editor's scroller", whichever surface is on screen, so a spec
      // does not have to know which branch it is looking at.
      data-testid="editor-scroller"
      className="flex-1 min-h-0 overflow-auto relative bg-paper text-ink select-text"
    >
      {isLoading ? (
        <div className="flex items-center justify-center h-full text-ink/40 text-xs gap-2">
          <Loader2 size={14} className="animate-spin" />
          <span>Loading file content...</span>
        </div>
      ) : unsupported ? (
        // Same distinction the desktop pane draws: a file refused for its KIND
        // was not a failed read, and saying so is the whole point.
        <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
          <FileX size={20} className="text-ink/40" />
          <span className="text-xs text-ink/70 font-sans">{fileName} cannot be opened here</span>
          <span className="text-[11px] text-ink/50 font-sans max-w-[42ch]">{unsupported}</span>
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
          <AlertTriangle size={20} className="text-error" />
          <span className="text-xs text-error font-sans">Could not read {fileName}</span>
          <span className="text-[11px] text-ink/50 font-mono break-all">{loadError}</span>
        </div>
      ) : (
        /* Markdown Preview Mode — styled by `.prose-content` (the chat
           timeline's system), see the desktop editor for why there is no
           `prose` wrapper. */
        <div className="p-4 bg-paper text-ink min-h-full font-sans" style={{ fontSize: `${fontSize}px` }}>
          <MarkdownRenderer content={content} document scope={{ path, root, repo }} />
        </div>
      )}
    </div>
  );
}
