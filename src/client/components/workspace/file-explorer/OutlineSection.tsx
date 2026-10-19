/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The outline, as a collapsible section at the BOTTOM of the Files panel.
 *
 * The shape is the Source Control panel's stash section, deliberately: the same
 * full-width `<button aria-expanded aria-controls>` toggle, the same `▸`/`▾`
 * glyph in a `w-3 font-mono` track, and the same `.section-reveal` body that
 * stays MOUNTED and `inert` while collapsed. Three sections in the git panel
 * already taught the reader that mark, and a fourth control drawn another way
 * reads as a different kind of thing.
 *
 * It is pinned below the tree rather than placed inside its scroller: the tree
 * is the `flex-1` member, so opening the outline SHRINKS the tree instead of
 * pushing the section off the bottom of a list the reader would have to chase.
 *
 * **The rows describe the file the EDITOR has open, not a row the tree
 * selected.** A click in the tree opens a tab; the editor is what holds the
 * buffer, and the outline is read from that buffer (`editor-document.ts`) so its
 * line numbers match what is on screen — including edits still waiting on the
 * debounced autosave. A diff tab, a binary viewer and a file a plugin draws all
 * publish a state with a reason, and the section prints the reason instead of an
 * empty list that would read as "this file has nothing in it".
 */

import { useId } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import { ListTree } from 'lucide-preact';
import { OutlineKindIcon, outlineKindLabel } from '@/client/components/common/outline-kind-icon';
import { getEditorDocument, subscribeEditorDocument } from '@/client/lib/editor-document';
import { setLineReveal } from '@/client/lib/line-reveal';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useOutlineView } from '@/client/hooks/editor/use-outline-view';
import type { OutlineSymbol } from '@/shared/lib/code/outline/types';

export function OutlineSection() {
  const [expanded, setExpanded] = useSessionState<boolean>('files.outlineExpanded', false);
  const bodyId = useId();
  const current = useSyncExternalStore(subscribeEditorDocument, getEditorDocument);

  // Recomputed from the LIVE buffer, so an edit moves the rows with it. The
  // scan is a depth-aware line walk (see `outline/extract.ts`): measured at
  // 0.1–2.2 ms on this repository's largest sources.
  const { symbols, notice } = useOutlineView({
    content: current.content,
    language: current.language,
    state: current.state,
    note: current.note,
  });

  // A diff tab HIDES the section rather than explaining that it has none. The
  // reader is comparing two versions of a file, where there is no source
  // document to outline, and a section that only ever said so occupied the
  // panel's floor for a question nobody asked. Every other state still renders,
  // because each of those is about a file that IS open.
  if (current.state === 'diff') return null;

  const jump = (symbol: OutlineSymbol) => {
    if (!current.path) return;
    // The row publishes the request; the editor that holds this file serves it
    // — selecting the NAME and scrolling the line into view — and clears the
    // store. The file is already the editor's active tab: the outline is its
    // own description. The column/length come from the extractor's own match
    // indices, so the selection covers the identifier rather than the line's
    // first word.
    setLineReveal({ path: current.path, line: symbol.line, column: symbol.column, length: symbol.name.length });
  };

  return (
    <div className="border-t border-ink/10 bg-canvas/30 flex-shrink-0">
      <div className="flex items-center hover:bg-ink/5 transition-colors">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          // The visible label is the word plus a count badge, so the accessible
          // name would change with the symbol count ("Outline 8"). A stable name
          // is what makes the control addressable by role — and what a screen
          // reader announces without the badge read as part of the label.
          aria-label="Outline"
          title={expanded ? 'Hide outline' : 'Show outline'}
          className="flex flex-1 min-w-0 items-center space-x-1 py-1.5 pl-3 pr-2 text-left font-semibold text-xs text-ink transition-colors cursor-pointer"
        >
          {/* `font-mono` is what makes this the SAME mark as the git panel's
              sections: the same codepoint in the sans stack comes out a quarter
              smaller (measured there as 4.65px of ink against 3.49px). */}
          <span className="w-3 text-center font-mono" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          <ListTree size={12} />
          <span>Outline</span>
          {symbols.length > 0 && (
            <span className="font-normal ml-1 border border-ink/20 rounded-full px-1.5 text-[9px] text-ink/50">
              {symbols.length}
            </span>
          )}
        </button>
      </div>

      {/* Mounted in both states so the reveal animates, and `inert` while
          collapsed so a hidden row is not tabbable. The clamp child carries no
          padding: `overflow: hidden` clips the content box, never the padding
          box, which left a sliver of body under a collapsed section. */}
      <div className="section-reveal" data-expanded={expanded} id={bodyId} inert={!expanded}>
        <div>
          <div className="px-2 pb-2">
            {symbols.length === 0 ? (
              <div className="px-1 text-[10px] text-ink/40 italic py-1">{notice}</div>
            ) : (
              <div className="max-h-48 overflow-y-auto scrollbar-overlay-container flex flex-col">
                {symbols.map((symbol) => (
                  <button
                    key={`${symbol.line}:${symbol.kind}:${symbol.name}`}
                    type="button"
                    onClick={() => jump(symbol)}
                    aria-label={`${outlineKindLabel(symbol.kind)} ${symbol.name}, line ${symbol.line}`}
                    title={`${outlineKindLabel(symbol.kind)} · line ${symbol.line}`}
                    className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-ink/5 active:bg-ink/10"
                    style={{ paddingLeft: `${4 + symbol.depth * 12}px` }}
                  >
                    <OutlineKindIcon kind={symbol.kind} />
                    <span className="min-w-0 flex-1 truncate text-[11px] font-mono text-ink/80">{symbol.name}</span>
                    <span className="flex-shrink-0 font-mono text-[9px] text-ink/35">{symbol.line}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
