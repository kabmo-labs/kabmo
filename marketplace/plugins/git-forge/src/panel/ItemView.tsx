/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One item: its title, its facts, its body and its conversation.
 *
 * The body is rendered through the kit's `Markdown`, which is Kabmo's own
 * marked/Shiki/KaTeX/mermaid pipeline injected by the host — the same reason the
 * wiki panel renders through it. A forge description is markdown with fenced
 * code and screenshots, and a `<pre>` of raw text would make the panel's most
 * useful surface the least readable one.
 *
 * **The header carries the item's own identity, and the link out is explicit.**
 * A reader who wants to comment, review or merge does it on the host; the panel
 * reads, and pretending otherwise would need a write API, a scope and a
 * confirmation flow this panel deliberately does not have.
 *
 * A failed DETAIL read leaves the list behind it intact and says why — the same
 * rule the list follows, one level down.
 */

import { Markdown } from '@kabmo-labs/kabmo-ui/components';

import type { ForgeDetail, ForgeItem } from '../protocol';
import { LabelChips, StateBadge } from './Badge';
import { Glyph, ICON } from './Glyph';
import { itemIdLabel, relativeTime } from './format';

interface ItemViewProps {
  item: ForgeItem;
  detail: ForgeDetail | null;
  loading: boolean;
  error: string | null;
  /**
   * The narrow layout's way back to the list. Hidden above the container
   * breakpoint, where the sections are still on screen — the same rule the wiki
   * page view applies to its own back control.
   */
  onBack: () => void;
}

export function ItemView({ item, detail, loading, error, onBack }: ItemViewProps) {
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

            {detail.comments.length > 0 && (
              <div className="border-t border-ink/10">
                <div className="px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">
                  {detail.comments.length} {detail.comments.length === 1 ? 'comment' : 'comments'}
                </div>
                {detail.comments.map((comment) => (
                  <div key={comment.id} className="border-t border-ink/8 px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-ink/45">
                      <span className="font-medium text-ink/70">{comment.author}</span>
                      <span>{relativeTime(comment.createdAt)}</span>
                    </div>
                    <div className="mt-0.5">
                      <Markdown content={comment.body} className="prose-content text-xs" />
                    </div>
                  </div>
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
    </div>
  );
}
