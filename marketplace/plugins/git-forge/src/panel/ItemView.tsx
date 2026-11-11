/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One item: its title, its facts, its body, its change and its conversation.
 *
 * The body is rendered through the kit's `Markdown`, which is Kabmo's own
 * marked/Shiki/KaTeX/mermaid pipeline injected by the host — the same reason the
 * wiki panel renders through it. A forge description is markdown with fenced
 * code and screenshots, and a `<pre>` of raw text would make the panel's most
 * useful surface the least readable one.
 *
 * **The header carries the item's own identity, and the link out is explicit.**
 * A reader who wants to comment, review or merge can do it here — but the host's
 * own page remains one click away, because that is where the diff view, the
 * review threads and the checks' logs live in full.
 *
 * **The back control is always drawn.** The item replaces the list at every
 * width, so a back control hidden at a wide container is a dead end: the reader
 * can open an item and has no way to return to the list it came from.
 *
 * **A system or bot comment is drawn differently.** GitLab's `system` notes are
 * "changed the description", "approved this merge request"; GitHub's App accounts
 * are `dependabot[bot]`. Both are worth showing — an approval recorded only as a
 * system note is the one place a reader learns who approved — and neither is a
 * reply, so both are drawn as a muted line rather than as a message with a body.
 */

import { Markdown } from '@kabmo-labs/kabmo-ui/components';

import type { ForgeComment, ForgeCredential, ForgeDetail, ForgeItem } from '../protocol';
import { LabelChips, StateBadge } from './Badge';
import { ChangeCommits, ChangeFiles } from './Change';
import { CiBadge } from './CiBadge';
import { Glyph, ICON } from './Glyph';
import { WriteBar } from './Write';
import { fullTime, itemIdLabel, relativeTime } from './format';
import type { ForgeWriteState } from './use-forge';

interface ItemViewProps {
  item: ForgeItem;
  detail: ForgeDetail | null;
  loading: boolean;
  error: string | null;
  /** Which credential the server resolved, for the one sentence worth saying. */
  credential: ForgeCredential | null;
  write: ForgeWriteState;
  onBack: () => void;
  onRetry: () => void;
}

const FOCUS = 'tap-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20';

/** One comment: a message, or a muted line when the host wrote it itself. */
function Comment({ comment }: { comment: ForgeComment }) {
  if (comment.system) {
    return (
      <div className="flex items-baseline gap-1.5 border-t border-ink/8 px-2.5 py-1">
        <span className="flex-shrink-0 text-[10px] font-medium text-ink/60">{comment.author}</span>
        <span className="min-w-0 flex-1 text-[10px] italic text-ink/55">{comment.body}</span>
      </div>
    );
  }
  return (
    <div className="border-t border-ink/8 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] text-ink/60">
        <span className="font-medium text-ink/80">{comment.author}</span>
        {comment.bot && (
          <span className="rounded border border-ink/15 px-1 text-[10px] uppercase tracking-wider text-ink/60">bot</span>
        )}
        <span title={fullTime(comment.createdAt)}>{relativeTime(comment.createdAt)}</span>
        {comment.url && (
          <a
            href={comment.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this comment on the host"
            aria-label="Open this comment on the host"
            className={`ml-auto cursor-pointer rounded p-0.5 text-ink/50 transition-colors hover:text-ink ${FOCUS}`}
          >
            <Glyph path={ICON.external} size={10} />
          </a>
        )}
      </div>
      <div className="mt-1">
        <Markdown content={comment.body} className="prose-content text-xs" />
      </div>
    </div>
  );
}

/** The body's loading shape, so the panel does not jump when the read lands. */
function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 px-2.5 py-3">
      <span className="h-2.5 w-32 animate-pulse rounded bg-ink/10" />
      <span className="h-2.5 w-full animate-pulse rounded bg-ink/5" />
      <span className="h-2.5 w-40 animate-pulse rounded bg-ink/5" />
      <span className="h-2.5 w-24 animate-pulse rounded bg-ink/5" />
    </div>
  );
}

export function ItemView({ item, detail, loading, error, credential, write, onBack, onRetry }: ItemViewProps) {
  const capabilities = detail?.capabilities ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-start gap-1.5 border-b border-ink/10 px-2.5 py-2">
        <button
          type="button"
          onClick={onBack}
          title="Back to the list"
          aria-label="Back to the list"
          className={`mt-0.5 flex-shrink-0 cursor-pointer rounded p-1 text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink ${FOCUS}`}
        >
          <Glyph path={ICON.back} size={13} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StateBadge state={item.state} />
            <span className="flex-shrink-0 font-mono text-[10px] text-ink/60">{itemIdLabel(item)}</span>
            <span className="min-w-0 truncate text-[10px] text-ink/60">
              {item.author} · <span title={fullTime(item.updatedAt)}>{relativeTime(item.updatedAt)}</span>
            </span>
            {detail?.ci && <CiBadge ci={detail.ci} />}
          </div>
          <span className="text-[13px] font-medium leading-snug text-ink">{item.title}</span>
          <LabelChips labels={item.labels} max={6} />
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open on the host"
          aria-label="Open on the host"
          className={`flex-shrink-0 cursor-pointer rounded p-1 text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink ${FOCUS}`}
        >
          <Glyph path={ICON.external} size={13} />
        </a>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-overlay-container">
        {error && (
          <div className="flex flex-col items-start gap-1.5 px-2.5 py-2">
            <p className="text-[11px] leading-relaxed text-error-text">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className={`cursor-pointer rounded border border-ink/20 px-2.5 py-1 text-[10px] text-ink transition-colors hover:bg-ink/5 ${FOCUS}`}
            >
              Try again
            </button>
          </div>
        )}

        {!detail && loading && <DetailSkeleton />}

        {detail && (
          <>
            {detail.facts.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-ink/8 px-2.5 py-2">
                {detail.facts.map((fact) => (
                  <span key={fact.label} className="flex items-baseline gap-1 text-[10px]">
                    <span className="uppercase tracking-wider text-ink/55">{fact.label}</span>
                    <span className="font-mono text-ink/80">{fact.value}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="px-2.5 py-2.5">
              {detail.body.trim() ? (
                <Markdown content={detail.body} className="prose-content text-xs" />
              ) : (
                <p className="text-[11px] italic text-ink/55">No description.</p>
              )}
            </div>

            <ChangeFiles files={detail.files} />
            <ChangeCommits commits={detail.commits} />

            {detail.comments.length > 0 && (
              <div className="border-t border-ink/10">
                <div className="flex items-baseline gap-1.5 px-2.5 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/55">Conversation</span>
                  <span className="font-mono text-[10px] tabular-nums text-ink/55">{detail.comments.length}</span>
                </div>
                {detail.comments.map((comment) => (
                  <Comment key={comment.id} comment={comment} />
                ))}
              </div>
            )}

            {detail.notes.length > 0 && (
              <div className="flex flex-col gap-0.5 border-t border-ink/8 px-2.5 py-1.5">
                {detail.notes.map((note) => (
                  <p key={note} className="text-[10px] leading-relaxed text-ink/60">
                    {note}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {detail && (
        <WriteBar item={item} capabilities={capabilities} write={write} {...(credential ? { credential } : {})} />
      )}
    </div>
  );
}
