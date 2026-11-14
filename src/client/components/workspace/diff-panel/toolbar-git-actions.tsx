/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The diff toolbar's two git writes, as clusters.
 *
 * Split out of `Toolbar.tsx` when the journal diff added a `readOnly` mode: the
 * file was already at the repo's line ceiling, and these are the only clusters
 * that write to git. A journal diff shows the agent's own snapshots, which are
 * not the worktree, so it renders neither.
 */

import { Minus, Plus, Undo2 } from 'lucide-preact';
import type { ToolbarCluster } from '@/client/components/common/toolbar-row';

/** Shared class for the toolbar's icon buttons. */
export const ACTION_CLASS =
  'flex items-center justify-center p-1.5 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink/50';

interface GitActionClustersArgs {
  isStaged: boolean;
  /** A write is in flight; the actions lock. */
  locked: boolean;
  /** A journal diff: no git writes at all. */
  readOnly: boolean;
  stageLabel: string;
  onStageUnstage: () => void;
  onDiscard: () => void;
}

/** Discard (unstaged only) and Stage/Unstage, in the toolbar's visual order. */
export function gitActionClusters({
  isStaged,
  locked,
  readOnly,
  stageLabel,
  onStageUnstage,
  onDiscard,
}: GitActionClustersArgs): ToolbarCluster[] {
  if (readOnly) return [];
  const clusters: ToolbarCluster[] = [];

  if (!isStaged) {
    clusters.push({
      id: 'discard',
      actions: [{ label: 'Discard changes in this file', icon: Undo2, onSelect: onDiscard, disabled: locked }],
      children: (
        <button
          type="button"
          onClick={onDiscard}
          className={`${ACTION_CLASS} text-ink/50 hover:text-error hover:bg-error/10`}
          title="Discard changes in this file"
          aria-label="Discard changes in this file"
          disabled={locked}
        >
          <Undo2 size={13} />
        </button>
      ),
    });
  }

  clusters.push({
    id: 'stage',
    // The panel's primary write: a menu row must not be the only way to stage.
    pinned: true,
    actions: [{ label: stageLabel, icon: isStaged ? Minus : Plus, onSelect: onStageUnstage, disabled: locked }],
    children: (
      <button
        type="button"
        onClick={onStageUnstage}
        className="px-2 py-1 text-[11px] font-medium rounded border border-ink/15 hover:bg-ink/5 flex items-center space-x-1 transition-colors text-ink cursor-pointer disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        title={stageLabel}
        aria-label={stageLabel}
        disabled={locked}
      >
        {isStaged ? (
          <>
            <Minus size={12} />
            <span className="hidden @[360px]:inline">Unstage</span>
          </>
        ) : (
          <>
            <Plus size={12} />
            <span className="hidden @[360px]:inline">Stage</span>
          </>
        )}
      </button>
    ),
  });

  return clusters;
}
