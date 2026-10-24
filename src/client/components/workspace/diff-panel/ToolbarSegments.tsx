/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The diff toolbar's two segmented controls.
 *
 * Split out because they are the widest part of the toolbar (a segment pair is
 * 130-190px, and the panel's floor is 320px) and because the pair carries a rule
 * of its own: each segment SETS its mode rather than toggling it. Clicking the
 * already-active segment used to flip the view to the other one, which made the
 * control mean two things depending on which half the reader aimed at.
 *
 * A separate group from each other because the two axes are orthogonal:
 * Unified/Split is the SHAPE of the rows, Full/Diff is how MANY of them there
 * are.
 */

import { AlignJustify, Columns, Diff, FileCode } from 'lucide-preact';
import type { DiffContentMode, DiffViewMode } from '@/client/components/workspace/diff-panel/Toolbar';

const SEGMENT_CLASS =
  'px-2 py-0.5 rounded text-[11px] font-medium flex items-center space-x-1 transition-colors cursor-pointer flex-shrink-0';

const GROUP_CLASS = 'flex items-center bg-canvas rounded border border-ink/15 p-0.5 mr-0.5 @[440px]:mr-1';

/** Row shape: side-by-side or unified. */
export function DiffViewModeSegments({
  viewMode,
  onSetViewMode,
}: {
  viewMode: DiffViewMode;
  onSetViewMode: (mode: DiffViewMode) => void;
}) {
  return (
    <div className={GROUP_CLASS}>
      <button
        type="button"
        onClick={() => onSetViewMode('split')}
        className={`${SEGMENT_CLASS} ${viewMode === 'split' ? 'bg-paper text-ink shadow-xs' : 'text-ink/60 hover:text-ink'}`}
        title="Split (side-by-side) diff"
        aria-label="Split (side-by-side) diff"
        aria-pressed={viewMode === 'split'}
      >
        <Columns size={12} />
        <span className="hidden @[420px]:inline">Split</span>
      </button>
      <button
        type="button"
        onClick={() => onSetViewMode('unified')}
        className={`${SEGMENT_CLASS} ${viewMode === 'unified' ? 'bg-paper text-ink shadow-xs' : 'text-ink/60 hover:text-ink'}`}
        title="Unified diff"
        aria-label="Unified diff"
        aria-pressed={viewMode === 'unified'}
      >
        <AlignJustify size={12} />
        <span className="hidden @[420px]:inline">Unified</span>
      </button>
    </div>
  );
}

/** How much of the file: the whole thing with changes marked, or the hunks. */
export function DiffContentModeSegments({
  contentMode,
  onSetContentMode,
}: {
  contentMode: DiffContentMode;
  onSetContentMode: (mode: DiffContentMode) => void;
}) {
  return (
    <div className={GROUP_CLASS}>
      <button
        type="button"
        onClick={() => onSetContentMode('full')}
        className={`${SEGMENT_CLASS} ${contentMode === 'full' ? 'bg-paper text-ink shadow-xs' : 'text-ink/60 hover:text-ink'}`}
        title="Full code (whole file, changes marked)"
        aria-label="Full code (whole file, changes marked)"
        aria-pressed={contentMode === 'full'}
      >
        <FileCode size={12} />
        <span className="hidden @[420px]:inline">Full Code</span>
      </button>
      <button
        type="button"
        onClick={() => onSetContentMode('diff')}
        className={`${SEGMENT_CLASS} ${contentMode === 'diff' ? 'bg-paper text-ink shadow-xs' : 'text-ink/60 hover:text-ink'}`}
        title="Diff only (changed hunks)"
        aria-label="Diff only (changed hunks)"
        aria-pressed={contentMode === 'diff'}
      >
        <Diff size={12} />
        <span className="hidden @[420px]:inline">Diff Only</span>
      </button>
    </div>
  );
}
