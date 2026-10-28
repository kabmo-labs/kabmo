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
import { itemIdLabel, relativeTime } from './format';
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
}

/** One comment: a message, or a muted line when the host wrote it itself. */
function Comment({ comment }: { comment: ForgeComment }) {
  if (comment.system) {
    return (
      <div className="flex items-baseline gap-1.5 border-t border-ink/8 px-2.5 py-1">
        <span className="flex-shrink-0 text-[10px] font-medium text-ink/55">{comment.author}</span>
        <span className="min-w-0 flex-1 text-[10px] italic text-ink/45">{comment.body}</span>
      </div>
    );
  }
  return (
    <div className="border-t border-ink/8 px-2.5 py-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-ink/45">
        <span className="font-medium text-ink/70">{comment.author}</span>
        {comment.bot && (
          <span className="rounded border border-ink/15 px-1 text-[9px] uppercase tracking-wider text-ink/45">bot</span>
        )}
        <span>{relativeTime(comment.createdAt)}</span>
        {comment.url && (
          <a
            href={comment.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this comment on the host"
            aria-label="Open this comment on the host"
            className="ml-auto text-ink/40 hover:text-ink"
          >
            <Glyph path={ICON.external} size={10} />
          </a>
        )}
      </div>
      <div className="mt-0.5">
        <Markdown content={comment.body} className="prose-content text-xs" />
      </div>
    </div>
  );
}

export function ItemView({ item, detail, loading, error, credential, write, onBack }: ItemViewProps) {
  const capabilities = detail?.capabilities ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-start gap-1.5 border-b border-ink/10 px-2.5 py-1.5">
        <button
          type="button"
          onClick={onBack}
          title="Back to the list"
          aria-label="Back to the list"
          className="mt-0.5 flex-shrink-0 rounded p-1 text-ink/60 hover:bg-ink/5 hover:text-ink @[520px]:hidden"
        >
          <Glyph path={ICON.back} size={13} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <StateBadge state={item.state} />
            <span className="flex-shrink-0 font-mono text-[10px] text-ink/45">{itemIdLabel(item)}</span>
            <span className="min-w-0 truncate text-[10px] text-ink/45">
              {item.author} · {relativeTime(item.updatedAt)}
            </span>
            {detail?.ci && <CiBadge ci={detail.ci} />}
          </div>
          <span className="text-xs font-medium leading-snug text-ink">{item.title}</span>
          <LabelChips labels={item.labels} max={6} />
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open on the host"
          aria-label="Open on the host"
          className="flex-shrink-0 rounded p-1 text-ink/60 hover:bg-ink/5 hover:text-ink"
        >
          <Glyph path={ICON.external} size={13} />
        </a>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-overlay-container">
        {error && (
          <div className="px-2.5 py-2">
            <p className="text-[11px] text-error">{error}</p>
          </div>
        )}

        {!detail && loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-ink/40">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-ink/30 border-t-ink/70" />
            <span className="text-[11px]">Reading…</span>
          </div>
        )}

        {detail && (
          <>
            {detail.facts.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-ink/8 px-2.5 py-1.5">
                {detail.facts.map((fact) => (
                  <span key={fact.label} className="flex items-baseline gap-1 text-[10px]">
                    <span className="uppercase tracking-wider text-ink/40">{fact.label}</span>
                    <span className="font-mono text-ink/75">{fact.value}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="px-2.5 py-2">
              {detail.body.trim() ? (
                <Markdown content={detail.body} className="prose-content text-xs" />
              ) : (
                <p className="text-[11px] italic text-ink/40">No description.</p>
              )}
            </div>

            <ChangeFiles files={detail.files} />
            <ChangeCommits commits={detail.commits} />

            {detail.comments.length > 0 && (
              <div className="border-t border-ink/10">
                <div className="px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">
                  {detail.comments.length} {detail.comments.length === 1 ? 'entry' : 'entries'}
                </div>
                {detail.comments.map((comment) => (
                  <Comment key={comment.id} comment={comment} />
                ))}
              </div>
            )}

            {detail.notes.length > 0 && (
              <div className="border-t border-ink/8 px-2.5 py-1.5">
                {detail.notes.map((note) => (
                  <p key={note} className="text-[10px] text-ink/50">
                    {note}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {detail && (
        <WriteBar
          item={item}
          detail={detail}
          capabilities={capabilities}
          write={write}
          {...(credential ? { credential } : {})}
        />
      )}
    </div>
  );
}
