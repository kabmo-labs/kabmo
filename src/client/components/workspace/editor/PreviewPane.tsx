/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rendered markdown document — the preview half of a markdown tab.
 *
 * Extracted from `FileDocument` for the per-file ceiling, and it earns the
 * boundary: everything here is "a document is on screen" (its scroller, its
 * scroll memory, its zoom, its table of contents target) while what surrounds it
 * is the editor's chrome.
 *
 * ## Two review states, one surface
 *
 * Review mode is a MODE the toolbar turns on. Off, the document is drawn exactly
 * as it always was — `MarkdownReview` passes no review bridge, so no block
 * attributes are emitted and every click keeps its meaning. On, the same
 * component draws the marks and the judgement editor. There is deliberately no
 * second preview component: one surface cannot drift from the other.
 */

import { MarkdownReview } from '@/client/components/common/markdown-review';

export interface PreviewPaneProps {
  content: string;
  file: { name: string; path: string; root?: string | null; repo?: string | null };
  zoomLevel: number;
  /** Review mode, owned by the editor's toolbar. */
  reviewActive: boolean;
  onExitReview: () => void;
  /** The scroller, shared by scroll restore and the table of contents. */
  scrollRef: (element: HTMLElement | null) => void;
  onScroll: () => void;
}

export function PreviewPane({
  content,
  file,
  zoomLevel,
  reviewActive,
  onExitReview,
  scrollRef,
  onScroll,
}: PreviewPaneProps) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      // No accessible name exists for a scroll container, so the E2E layer
      // addresses it by testid (see `tests/e2e/fixtures/selectors.ts`).
      data-testid="editor-scroller"
      className="flex-1 overflow-auto bg-paper flex"
    >
      {/* No `prose` wrapper: markdown is styled by `.prose-content` alone
          (the same system the chat timeline uses). The typography plugin
          fought it — `.prose img` added 2em vertical margins that ballooned
          a badge row into its own line box, and `--tw-prose-*` colors ignored
          the theme. */}
      <div className="p-6 max-w-4xl mx-auto font-sans flex-1" style={{ fontSize: `${zoomLevel}px` }}>
        <MarkdownReview
          content={content}
          file={file}
          active={reviewActive}
          onExit={onExitReview}
        />
      </div>
    </div>
  );
}
