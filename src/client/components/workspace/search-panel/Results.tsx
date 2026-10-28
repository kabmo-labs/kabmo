/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The search result list, windowed.
 *
 * A search for a common word returns tens of thousands of hits, and the panel
 * used to mount every one of them — measured on this repo, a search for `const`
 * produced 19,376 rows, 385,706 DOM nodes and 34 s of blocked main thread for a
 * five-step scroll. Only the rows a viewport can show are mounted here,
 * positioned by the exact offsets `search-list.ts` computes from measured row
 * heights.
 *
 * Three details are load-bearing:
 *
 * - **The gaps are spacers, not CSS margins.** A windowed list has a different
 *   set of siblings on every scroll, so `space-y-*` would draw a gap between
 *   whichever two rows happened to be adjacent. The layout module folds each
 *   gap into its row's height instead.
 * - **The scrollbar reflects the whole result set.** Top and bottom spacers
 *   stand in for the rows that are not mounted, so the thumb's size and the
 *   distance it travels are the real ones and a jump lands where it should.
 * - **Scroll anchoring is off.** The browser's own anchoring tries to hold the
 *   anchored node in place when rows mount and unmount underneath it, which
 *   fights the offsets this list is positioning by.
 *
 * The scroll handler re-renders only when the mounted RANGE changes, and each
 * row is memoized, so a scroll repaints the spacers and the rows already on
 * screen — never the result set.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { FileIcon } from '@/client/components/common/file-icon';
import { Replace } from 'lucide-preact';

import { SearchRow } from '@/client/components/workspace/search-panel/Row';
import {
  DEFAULT_SEARCH_ROW_METRICS,
  buildSearchRows,
  layoutSearchRows,
  searchWindow,
  type SearchGroup,
  type SearchRowMetrics,
} from '@/shared/lib/fs/search-list';
import type { SearchResultItem } from '@/shared/types/fs';

/** The container's vertical padding, carried by the spacers so offsets stay exact. */
const PAD_TOP = 8;
const PAD_BOTTOM = 8;

interface SearchResultsProps {
  groups: readonly SearchGroup[];
  replacement: string;
  showReplacePreview: boolean;
  onOpen: (result: SearchResultItem) => void;
  /** Replace every hit in one file; disabled while a replace is in flight. */
  onReplaceFile: (file: string) => void;
  replaceBusy: boolean;
}

export function SearchResults({
  groups,
  replacement,
  showReplacePreview,
  onOpen,
  onReplaceFile,
  replaceBusy,
}: SearchResultsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => buildSearchRows(groups), [groups]);
  const [metrics, setMetrics] = useState<SearchRowMetrics>(DEFAULT_SEARCH_ROW_METRICS);
  const layout = useMemo(() => layoutSearchRows(rows, metrics), [rows, metrics]);

  // A generous first window; the layout effect below replaces it with the real
  // viewport as soon as the container can be measured.
  const [win, setWin] = useState(() => ({ start: 0, end: Math.min(rows.length, 60) }));

  const attachContainer = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
  }, []);

  const syncWindow = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const next = searchWindow(layout.offsets, layout.heights, element.scrollTop, element.clientHeight);
    setWin((previous) => (previous.start === next.start && previous.end === next.end ? previous : next));
  }, [layout]);

  // Only the window: the scrollbar's own reveal is the app-wide rule's job
  // (`lib/scrollbar-activity`), so this handler stays as cheap as the
  // virtualization needs it to be — one state update per scroll, no class
  // toggling on a list that re-renders thousands of rows.
  const handleScroll = useCallback(() => {
    syncWindow();
  }, [syncWindow]);

  // Measure the real TEXT box heights once they are on screen, so a font or
  // zoom change is followed instead of being frozen into a constant. The
  // wrappers carry the layout's own height (a gap included), so the target of
  // the measurement is the content inside them — measuring a wrapper would feed
  // the gap back into the value that defines it.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const headerBox = list.querySelector<HTMLElement>('[data-search-header] > div')?.offsetHeight ?? 0;
    const hitBox = list.querySelector<HTMLElement>('[data-search-hit] > button')?.offsetHeight ?? 0;
    if (headerBox > 0 && headerBox !== metrics.headerBox) setMetrics((current) => ({ ...current, headerBox }));
    if (hitBox > 0 && hitBox !== metrics.hitBox) setMetrics((current) => ({ ...current, hitBox }));
  }, [win, metrics, rows]);

  // The viewport is only known after mount, and it changes on resize.
  useLayoutEffect(() => {
    syncWindow();
  }, [syncWindow]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => syncWindow());
    observer.observe(element);
    return () => observer.disconnect();
  }, [syncWindow]);

  const start = rows.length === 0 ? 0 : Math.min(win.start, rows.length - 1);
  const end = Math.min(win.end, rows.length);
  const visible = rows.slice(start, end);
  const below = end < rows.length ? layout.total - layout.offsets[end] : 0;

  return (
    <div
      ref={attachContainer}
      onScroll={handleScroll}
      className="flex-1 scrollbar-overlay-container px-3 text-xs"
      style={{ overflowAnchor: 'none' }}
    >
      <div style={{ height: PAD_TOP + (layout.offsets[start] ?? 0) }} aria-hidden="true" />
      <div ref={listRef}>
        {visible.map((entry, offset) => {
          const index = start + offset;
          // The row's own height IS the layout's, gaps included, so the DOM
          // geometry and the offsets the spacers are sized from cannot drift —
          // rendering natural heights and relying on the arithmetic would leave
          // every row a gap short and land a jump on the wrong hit.
          const height = layout.heights[index];
          if (entry.kind === 'group') {
            return (
              <div key={`group:${entry.file}`} data-search-header="" style={{ height }}>
                <div className="font-semibold text-ink/80 flex items-center justify-between group">
                  <div className="flex items-center min-w-0">
                    <FileIcon name={entry.file} size={12} className="mr-1.5 flex-shrink-0" />
                    <span className="truncate">{entry.file}</span>
                    <span className="ml-2 bg-ink/10 text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0">
                      {entry.count}
                    </span>
                  </div>
                  <button
                    onClick={() => onReplaceFile(entry.file)}
                    disabled={replaceBusy}
                    className="touch-visible opacity-0 group-hover:opacity-100 p-1 text-ink/40 hover:text-ink rounded hover:bg-ink/5 disabled:opacity-50 flex-shrink-0"
                    title="Replace in this file"
                  >
                    <Replace size={12} />
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={`hit:${entry.file}:${entry.result.line}:${index}`} data-search-hit="" style={{ height }}>
              <SearchRow
                file={entry.file}
                result={entry.result}
                replacement={replacement}
                showReplacePreview={showReplacePreview}
                onOpen={onOpen}
              />
            </div>
          );
        })}
      </div>
      <div style={{ height: PAD_BOTTOM + below }} aria-hidden="true" />
    </div>
  );
}
