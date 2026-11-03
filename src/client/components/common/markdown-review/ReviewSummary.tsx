/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The review's totals, the way out, and the marks that no longer fit.
 *
 * Two rules this bar exists to keep:
 *
 * - **An outdated mark is SHOWN.** Its block was edited, so it matches nothing
 *   rendered — but the note is still the user's and the only copy of it.
 *   Dropping it silently is the one thing a review tool must never do, so it is
 *   listed with its stored quote and a Remove of its own.
 * - **Sending is a prefill.** The button says "to the chat box": it writes the
 *   draft and focuses the composer. A review the user never read before it
 *   reached the agent is how a wrong note becomes an instruction.
 */

import { Send, X } from 'lucide-preact';

import type { DocumentAnnotation } from '@/shared/lib/markdown/blocks/types';

interface ReviewSummaryProps {
  counts: { good: number; needsWork: number };
  outdated: readonly DocumentAnnotation[];
  error: string | null;
  /** True once the block reached the composer, so the bar can say so. */
  sent: boolean;
  onSend: () => void;
  onRemoveOutdated: (id: string) => void;
  onExit: () => void;
}

function rangeOf(annotation: DocumentAnnotation): string {
  return annotation.lineStart === annotation.lineEnd
    ? `L${annotation.lineStart}`
    : `L${annotation.lineStart}-${annotation.lineEnd}`;
}

export function ReviewSummary({ counts, outdated, error, sent, onSend, onRemoveOutdated, onExit }: ReviewSummaryProps) {
  const total = counts.good + counts.needsWork;

  return (
    <div className="sticky bottom-0 z-40 mt-2 border-t border-ink/10 bg-paper/95 px-1 py-2 backdrop-blur">
      {outdated.length > 0 && (
        <div className="mb-1.5 space-y-1">
          <div className="text-[10px] uppercase font-mono text-ink/40">
            {outdated.length} outdated — the block was edited or is no longer rendered
          </div>
          {outdated.map((annotation) => (
            <div key={annotation.id} className="flex items-start gap-1.5 text-[11px] text-ink/60">
              <span className="font-mono text-[10.5px] text-ink/40">{rangeOf(annotation)}</span>
              {/* Both halves, because they say different things: the QUOTE is
                  the block this note was written about, the NOTE is what the
                  user said about it — and the note is the reason the row is
                  worth keeping at all. */}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink/45">{annotation.quote || '(block text unavailable)'}</span>
                {annotation.note.trim() && <span className="block truncate text-ink/70">{annotation.note}</span>}
              </span>
              <button
                type="button"
                onClick={() => onRemoveOutdated(annotation.id)}
                className="cursor-pointer text-ink/40 hover:text-error"
                aria-label={`Remove outdated annotation at ${rangeOf(annotation)}`}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="mb-1.5 text-[11px] text-error">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 font-sans text-[11px]">
        <span className="text-ink/70">
          <span className="text-ink">{counts.good}</span> good ·{' '}
          <span className="text-error">{counts.needsWork}</span> needs work
        </span>
        {sent && <span className="text-ink/50">Added to the chat box</span>}
        <button
          type="button"
          onClick={onExit}
          className="ml-auto cursor-pointer p-1 text-ink/50 hover:text-ink"
          title="Exit review mode"
          aria-label="Exit review mode"
        >
          <X size={13} />
        </button>
        <button
          type="button"
          disabled={total === 0}
          onClick={onSend}
          title="Put this review into the chat box — you still choose to send it"
          className="flex items-center gap-1 rounded border border-ink bg-ink px-2 py-1 text-canvas transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send size={11} /> Send to chat
        </button>
      </div>
    </div>
  );
}
