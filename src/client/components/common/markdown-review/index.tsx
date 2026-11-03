/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Per-block review on a rendered markdown document: "this paragraph is good,
 * that one needs work", with the verdicts handed to the agent as one prompt.
 *
 * ## Off unless the toolbar button turned it on
 *
 * `active` is the whole difference between this and an ordinary preview. Off:
 * the renderer emits no block attributes, nothing is fetched, and every click
 * keeps its usual meaning — links, copy buttons, the diagram viewer. On: each
 * top-level block becomes addressable, a click opens the judge panel, and a rail
 * stripe says what has been decided. An always-on layer would take those clicks
 * away from a reader who never asked to review anything, which is why the mode
 * is entered from a toolbar button and nowhere else.
 *
 * ## Identity is the block's text, not its line
 *
 * A render has no lines, and a line number lies the moment text above it is
 * inserted. Each block carries `type:hash#occurrence` (`blocks/anchor.ts`), so a
 * judgement follows its paragraph around the document; when the block's own text
 * changes the anchor stops matching and the mark is reported as OUTDATED with
 * its note intact — never dropped.
 */

import { useEffect, useState } from 'preact/hooks';

import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { ReviewPopover } from '@/client/components/common/markdown-review/ReviewPopover';
import { ReviewSummary } from '@/client/components/common/markdown-review/ReviewSummary';
import { usePreviewReview } from '@/client/hooks/editor/use-preview-review';

export interface MarkdownReviewProps {
  /** The document's text — the preview's buffer, not a re-read from disk. */
  content: string;
  file: { name: string; path: string; root?: string | null; repo?: string | null };
  /** Review mode, owned by the editor's toolbar. */
  active: boolean;
  /** The exit control inside the summary bar; the toolbar owns the same switch. */
  onExit: () => void;
}

export function MarkdownReview({ content, file, active, onExit }: MarkdownReviewProps) {
  const review = usePreviewReview({ file, active });
  const [sent, setSent] = useState(false);

  // A scroll moves the block out from under a fixed panel, so closing is the
  // honest answer — see `ReviewPopover`.
  useEffect(() => {
    if (!review.selected) return;
    const onScroll = () => review.close();
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [review.selected]);

  // The mode was switched off (toolbar, or another tab of the same file): the
  // panel must not survive into the ordinary preview.
  useEffect(() => {
    if (!active) review.close();
  }, [active]);

  // "Added to the chat box" describes the LAST send, so a change to what would be
  // sent retires it: leaving it up after a mark was removed would claim the
  // composer holds the review that is on screen.
  const total = review.counts.good + review.counts.needsWork;
  useEffect(() => {
    setSent(false);
  }, [total]);

  const selected = review.selectedBlock;
  const annotation = review.selectedAnnotation;

  return (
    // The class is what review mode's CSS hangs off, so the hover and rail rules
    // exist only while the mode is on.
    <div className={active ? 'md-review-active' : undefined}>
      <MarkdownRenderer
        content={content}
        document
        scope={{ path: file.path, root: file.root ?? undefined, repo: file.repo ?? undefined }}
        onBlocks={review.setBlocks}
        review={
          active
            ? { active: true, marks: review.marks, selected: review.selected, onPick: review.pick }
            : undefined
        }
      />

      {active && selected && review.anchor && (
        <ReviewPopover
          // A new block is a new form: the textarea's draft must not follow the
          // selection.
          key={selected.key}
          block={selected}
          verdict={review.marks.get(selected.key) ?? null}
          note={annotation?.note ?? ''}
          anchor={review.anchor}
          onSave={(verdict, note) => {
            review.save({ block: selected, verdict, note });
            review.close();
          }}
          onRemove={() => {
            if (annotation) review.remove(annotation.id);
            review.close();
          }}
          onClose={review.close}
        />
      )}

      {active && (
        <ReviewSummary
          counts={review.counts}
          outdated={review.outdated}
          error={review.error}
          sent={sent}
          onSend={() => setSent(review.send())}
          onRemoveOutdated={review.remove}
          onExit={() => {
            review.close();
            onExit();
          }}
        />
      )}
    </div>
  );
}
