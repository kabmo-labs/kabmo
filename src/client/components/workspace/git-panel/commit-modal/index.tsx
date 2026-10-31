import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Loader2 } from 'lucide-preact';
import type { CommitHistoryPage } from '@/shared/types/git';
import { Header } from '@/client/components/workspace/git-panel/commit-modal/Header';
import { GraphCanvas } from '@/client/components/workspace/git-panel/commit-modal/GraphCanvas';
import { CommitRow } from '@/client/components/workspace/git-panel/commit-modal/CommitRow';
import { computeCommitLanes } from '@/shared/lib/fs/git-graph';
import { useCommitPagination } from '@/client/hooks/workspace/commit-pagination';
import { useCommitInteractions } from '@/client/hooks/workspace/commit-interactions';

interface GitCommitModalProps {
  output: CommitHistoryPage | null;
  onClose: () => void;
  onRefresh?: () => void;
  onExecuteAction?: (actionType: string, file?: string, extra?: Record<string, string>) => void;
  rootPath?: string;
  activeRepo?: string;
}

export function GitCommitModal({
  output,
  onClose,
  onRefresh,
  onExecuteAction,
  rootPath,
  activeRepo,
}: GitCommitModalProps) {
  if (!output) return null;

  /**
   * The mode belongs to the PAGE, not to the component's lifetime.
   *
   * The modal stays mounted across opens (`GitPanel` renders it always and this
   * returns null while `output` is null), so a `useState` seeded from the first
   * title survived into every later page: History once, then Graph, and the
   * second request rendered History — wrong heading, no graph columns
   * (verified: `HEADINGS: ["(null)","History",…,"History"]` for a
   * `Commit History` → `Git Graph` sequence). Deriving it during render rather
   * than in an effect is what keeps the first paint of the new page correct
   * instead of showing the previous page's mode for a frame.
   */
  const [page, setPage] = useState(() => ({
    title: output.title,
    graph: output.title.toLowerCase().includes('graph'),
  }));
  if (page.title !== output.title) {
    setPage({ title: output.title, graph: output.title.toLowerCase().includes('graph') });
  }
  const isGraphMode = page.graph;
  const setIsGraphMode = (graph: boolean) => setPage((current) => ({ ...current, graph }));

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedHash, setSelectedHash] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    commits,
    hasMore,
    totalCount,
    isLoadingMore,
    handleLoadMore,
  } = useCommitPagination({
    output,
    isGraphMode,
    rootPath,
    activeRepo,
  });

  const {
    fileDiffs,
    expandedFiles,
    loadingFiles,
    fullContextFiles,
    handleToggleFile,
    handleToggleContext,
    handleCommitAction,
  } = useCommitInteractions({
    onExecuteAction,
    rootPath,
    activeRepo,
  });

  // Set initial selected commit
  useEffect(() => {
    if (commits.length > 0 && !selectedHash) {
      setSelectedHash(commits[0].hash);
    }
  }, [commits, selectedHash]);

  // Filter commits based on search query
  const filteredCommits = useMemo(() => {
    if (!searchQuery.trim()) return commits;
    const q = searchQuery.toLowerCase().trim();
    return commits.filter(
      (c) =>
        c.message.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.shortHash.toLowerCase().includes(q) ||
        c.hash.toLowerCase().includes(q) ||
        c.refs?.some((r) => r.toLowerCase().includes(q))
    );
  }, [commits, searchQuery]);

  // Measure dynamic positions of each commit node so lines never break
  const containerRef = useRef<HTMLDivElement>(null);
  const rowsContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [nodePositions, setNodePositions] = useState<Record<string, number>>({});
  const [totalHeight, setTotalHeight] = useState<number>(800);

  // Infinite scroll intersection observer
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || isLoadingMore || searchQuery.trim()) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          handleLoadMore();
        }
      },
      { root: containerRef.current, threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, searchQuery, handleLoadMore]);

  const measurePositions = useCallback(() => {
    if (!containerRef.current || !rowsContainerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const scrollTop = containerRef.current.scrollTop;
    const newPositions: Record<string, number> = {};

    filteredCommits.forEach((commit, idx) => {
      const el = headerRefs.current[commit.hash];
      if (el) {
        const rect = el.getBoundingClientRect();
        newPositions[commit.hash] = rect.top + rect.height / 2 - containerRect.top + scrollTop;
      } else {
        newPositions[commit.hash] = idx * 60 + 20;
      }
    });

    setNodePositions(newPositions);
    const contentH = rowsContainerRef.current.offsetHeight;
    setTotalHeight(Math.max(contentH, containerRef.current.clientHeight, 600));
  }, [filteredCommits]);

  /**
   * `selectedHash` is a dependency because SELECTING a row MOVES the rows
   * below it: the action strip renders under the selected subject line, so the
   * row it lands on grows by that strip's height while the row that had it
   * shrinks by exactly the same — the container's TOTAL height does not move,
   * so the ResizeObserver below never fires and every node keeps its
   * pre-selection `y`.
   *
   * Measured in the browser on a 50-commit page: with the first row selected
   * and the third clicked, row 0 went 170.1px → 121.6px and row 2 went
   * 152.9px → 201.4px, the total stayed put, and the node for row 1 sat
   * 48.5px BELOW the subject line it names — the reported "point tidak lurus
   * dengan commit title". The measurement reads live rects, so re-running it
   * is the whole fix; the effect is layout-timed, so the re-measured node is
   * painted in the same frame as the row that moved.
   */
  useLayoutEffect(() => {
    measurePositions();
    const rafId = requestAnimationFrame(() => {
      measurePositions();
    });
    return () => cancelAnimationFrame(rafId);
  }, [measurePositions, filteredCommits, fileDiffs, expandedFiles, isGraphMode, selectedHash]);

  /**
   * Observe the container AND every row inside it.
   *
   * The container alone is not enough, and that is the bug this fixes. A row's
   * box can change while the container's does not: selecting a commit renders
   * the action strip under its subject line, so the row that gains the strip
   * grows by exactly what the row that loses it shrinks by. The total is
   * unchanged, no container resize is reported, and every node keeps the `y` it
   * was measured at before the click.
   *
   * Measured in the browser on a 50-commit page: with the first row selected
   * and the third clicked, row 0 went 170.1px → 121.6px and row 2 went
   * 152.9px → 201.4px, the container total stayed put, and the node for row 1
   * sat 48.5px BELOW the subject line it names — the reported "point tidak
   * lurus dengan commit title". `selectedHash` in the effect's dependencies is
   * what fixes that case immediately; observing the rows is what keeps the
   * invariant true for the NEXT per-row change that happens to net out, rather
   * than requiring this list to name every prop that can move a row.
   */
  useEffect(() => {
    const el = rowsContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      measurePositions();
    });
    observer.observe(el);
    for (const row of Array.from(el.children)) observer.observe(row);
    return () => observer.disconnect();
  }, [measurePositions, filteredCommits]);

  // Lane calculations
  const laneMap = useMemo(() => computeCommitLanes(filteredCommits), [filteredCommits]);
  const maxLane = useMemo(() => {
    let max = 0;
    laneMap.forEach((l) => {
      if (l > max) max = l;
    });
    return max;
  }, [laneMap]);

  const laneWidth = 18;
  const paddingLeft = 16;
  const graphWidth = isGraphMode ? (maxLane + 1) * laneWidth + paddingLeft * 2 : 36;

  const handleRefresh = () => {
    setIsRefreshing(true);
    onRefresh?.();
    setTimeout(() => setIsRefreshing(false), 600);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/80 backdrop-blur-xs flex items-center justify-center p-0 lg:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-paper border-ink/20 shadow-2xl flex flex-col overflow-hidden
          w-full h-full rounded-none border-0
          lg:w-[min(94vw,1200px)] lg:h-[88vh] lg:rounded-xl lg:border
          pt-[env(safe-area-inset-top,0px)] lg:pt-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <Header
          isGraphMode={isGraphMode}
          onToggleMode={setIsGraphMode}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onRefresh={handleRefresh}
          onClose={onClose}
          isRefreshing={isRefreshing}
          totalCommits={filteredCommits.length}
          loadedCount={commits.length}
          totalCount={totalCount}
          hasMore={hasMore}
        />

        {/* Commits Container with Unified Continuous SVG Canvas */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto scrollbar-overlay-container relative select-text"
        >
          {filteredCommits.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-ink/40 font-mono text-xs">
              {searchQuery.trim() ? 'No matching commits found.' : 'No commits in this branch.'}
            </div>
          ) : (
            <div className="relative min-h-full pb-8">
              {/* Continuous Graph Canvas (Single unbroken SVG spanning the whole scroll list) */}
              <GraphCanvas
                commits={filteredCommits}
                nodePositions={nodePositions}
                selectedHash={selectedHash}
                isGraphMode={isGraphMode}
                laneWidth={laneWidth}
                paddingLeft={paddingLeft}
                totalHeight={totalHeight}
              />

              {/* Commit Rows */}
              <div
                ref={rowsContainerRef}
                className="flex flex-col relative z-20"
                style={{ paddingLeft: `${graphWidth}px` }}
              >
                {filteredCommits.map((commit) => (
                  <CommitRow
                    key={commit.hash}
                    commit={commit}
                    isSelected={selectedHash === commit.hash}
                    isGraphMode={isGraphMode}
                    onSelect={(c) => setSelectedHash(c.hash)}
                    onAction={handleCommitAction}
                    onToggleFile={handleToggleFile}
                    isExpandedFile={(h, f) => expandedFiles.has(`${h}:${f}`)}
                    isLoadingFile={(h, f) => loadingFiles.has(`${h}:${f}`)}
                    isFullContextFile={(h, f) => fullContextFiles.has(`${h}:${f}`)}
                    onToggleContext={handleToggleContext}
                    fileDiffs={fileDiffs}
                    headerRef={(el) => {
                      headerRefs.current[commit.hash] = el;
                    }}
                  />
                ))}

                {/* Lazy Load Sentinel & Controls */}
                <div ref={sentinelRef} className="pt-3 pb-4 px-4 flex items-center justify-center">
                  {isLoadingMore ? (
                    <div className="flex items-center gap-2 text-xs text-ink/60 font-mono py-2">
                      <Loader2 size={14} className="animate-spin text-info" />
                      <span>Loading more commits...</span>
                    </div>
                  ) : hasMore && !searchQuery.trim() ? (
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      className="px-3 py-1.5 text-xs font-mono text-ink/70 hover:text-ink bg-ink/5 hover:bg-ink/10 rounded-md border border-ink/10 transition-colors cursor-pointer"
                    >
                      Load more commits...
                    </button>
                  ) : filteredCommits.length > 10 ? (
                    <div className="text-[11px] font-mono text-ink/40 py-2">
                      End of commit history ({typeof totalCount === 'number' && totalCount > 0 ? totalCount : commits.length} commits)
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
