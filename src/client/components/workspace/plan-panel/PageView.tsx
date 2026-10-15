/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One plan artifact, rendered through the app's own markdown pipeline.
 *
 * The renderer is the chat timeline's DEFAULT mode — the same treatment an
 * agent-written message gets: headings, tables, code fences with highlighting
 * and mermaid hydration, all of it.
 *
 * Deliberately NOT `document` mode. That mode rewrites relative references
 * against the document's own directory, which is right for a file inside the
 * workspace and wrong here: a plan lives in the session's artifact directory
 * (under `~/.omp/agent/sessions/…`), outside every browse scope, so every
 * relative reference would be rewritten into a `/api/fs/raw` URL that 404s.
 * Left alone, a reference reads as the text the plan wrote — which is what the
 * timeline already does for agent markdown, and honest about the fact that this
 * view does not resolve them.
 *
 * There is no "open on the host" link and no editing surface. The plan belongs
 * to omp, and the review popup — not this view — is what decides one.
 */

import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import type { SessionPlanFile } from '@/shared/types/plan';

interface PlanPageViewProps {
  file: SessionPlanFile | null;
  content: string | null;
  isLoading: boolean;
  error: string | null;
  truncated: boolean;
  onBack: () => void;
}

export function PlanPageView({
  file,
  content,
  isLoading,
  error,
  truncated,
  onBack,
}: PlanPageViewProps) {

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-paper">
      <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-ink/10 px-2.5 py-1.5">
        <button
          type="button"
          onClick={onBack}
          title="Back to the plan list"
          aria-label="Back to the plan list"
          className="flex-shrink-0 rounded p-1 text-ink/60 hover:bg-ink/5 hover:text-ink @[520px]:hidden"
        >
          <ArrowLeft size={13} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink/50" title={file?.path ?? ''}>
          {file?.path ?? 'Plan'}
        </span>
        {isLoading && <Loader2 size={12} className="flex-shrink-0 animate-spin text-ink/40" />}
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto scrollbar-overlay-container"
      >
        {error ? (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <AlertCircle size={16} className="text-error" />
            <p className="text-xs text-error">{error}</p>
          </div>
        ) : !content ? (
          <div className="px-6 py-8 text-center text-xs text-ink/40">
            {isLoading ? 'Reading the plan…' : 'This plan is empty.'}
          </div>
        ) : (
          <article className="mx-auto max-w-4xl px-5 py-4">
            <MarkdownRenderer content={content} className="max-w-none" />
            {truncated && (
              <p className="mt-4 border-t border-ink/10 pt-2 text-[11px] text-ink/50">
                This plan is longer than the reader's budget and was cut off.
              </p>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
