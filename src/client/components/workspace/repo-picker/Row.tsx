/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One repository row in the repo management modal.
 *
 * **Two lines, always, and that is a measurement rather than a taste.** The
 * first shape was five fixed columns (check / name / branch / state / actions)
 * like `BranchRow`, which is right for a dialog that is always ~700px wide. This
 * one is `min(96vw, 720px)`, so on a 390px phone it is **358px** — and the fixed
 * tracks alone are 320px of columns plus 32px of gaps plus 32px of padding,
 * **384px of fixed content in a 358px box**. The name's `minmax(0,1fr)` track
 * collapses to zero and every repository name is clipped to nothing, which is
 * the one thing a repository row exists to show. Verified in the browser at
 * 390×844 before the change.
 *
 * So line 1 is identity (check, name, actions) and line 2 is state (branch and
 * the badges), which needs no breakpoint and cannot overflow: the badge strip
 * wraps, and the name owns whatever the actions leave.
 *
 * **The state line is the row's whole value.** A repository list is a list of
 * working trees, and what a reader needs is which ones are dirty, which have
 * commits to push, and which are stopped on a conflict — none of which the name
 * says. A clean, in-sync repo says so explicitly rather than showing an empty
 * strip, which would read as "not loaded".
 */

import type { ComponentChild } from 'preact';
import { AlertTriangle, ArrowDown, ArrowUp, Check, Copy, FolderOpen, GitBranch } from 'lucide-preact';
import type { GitRepoDetail } from '@/shared/types/git';
import { OPERATION_LABELS } from '@/shared/lib/fs/git-unmerged';

interface RepoRowProps {
  row: GitRepoDetail;
  /** True when this is the repo the panels are showing. */
  active: boolean;
  /** The row's label — the repo's own name within its group. */
  name: string;
  /** True while a read is in flight, so Copy is not racing a stale path. */
  loading: boolean;
  onSelect: () => void;
  onCopyPath: () => void;
  onReveal: () => void;
}

export function RepoRow({ row, active, name, loading, onSelect, onCopyPath, onReveal }: RepoRowProps) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_3.5rem] items-start gap-x-2 px-4 py-2 border-b border-ink/5 last:border-b-0 hover:bg-ink/[0.02] group/row transition-colors">
      <div className="h-5 flex items-center justify-center">
        {active && <Check size={12} className="text-ink" aria-label="Selected repository" />}
      </div>

      <button
        type="button"
        onClick={onSelect}
        disabled={active || !row.isRepo}
        title={
          !row.isRepo
            ? (row.error ?? 'Not a git repository')
            : active
              ? 'Already showing this repository'
              : `Show ${row.path}`
        }
        className="min-w-0 text-left cursor-pointer disabled:cursor-default"
      >
        <div className="h-5 flex items-center gap-1.5 min-w-0">
          <GitBranch size={11} className={active ? 'text-ink/60 flex-shrink-0' : 'text-ink/40 flex-shrink-0'} />
          <span className={`truncate text-xs ${active ? 'font-semibold text-ink' : 'text-ink/90'}`}>{name}</span>
        </div>
      </button>

      <div className="h-5 flex items-center justify-end gap-0.5 touch-visible opacity-0 group-hover/row:opacity-100">
        <button
          type="button"
          onClick={onCopyPath}
          disabled={loading}
          title={`Copy the absolute path of ${row.path}`}
          aria-label={`Copy path of ${row.path}`}
          className="w-5 h-5 flex items-center justify-center rounded text-ink/40 hover:text-ink hover:bg-ink/10 cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default"
        >
          <Copy size={11} />
        </button>
        <button
          type="button"
          onClick={onReveal}
          title={`Reveal ${row.path} in the file manager`}
          aria-label={`Reveal ${row.path}`}
          className="w-5 h-5 flex items-center justify-center rounded text-ink/40 hover:text-ink hover:bg-ink/10 cursor-pointer transition-colors"
        >
          <FolderOpen size={11} />
        </button>
      </div>

      {/* Line 2: the state line, spanning the identity columns. It WRAPS rather
          than overflowing, which is what makes this layout width-independent. */}
      <div className="col-start-2 col-span-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 mt-0.5">
        {row.isRepo ? (
          <>
            <span
              className={`text-[10px] font-mono truncate ${row.detached ? 'text-warning' : 'text-ink/50'}`}
              title={row.detached ? `Detached HEAD at ${row.branch}` : `On branch ${row.branch}`}
            >
              {row.branch}
            </span>
            <span className="text-[10px] text-ink/25" aria-hidden>
              ·
            </span>
            <StateBadges row={row} />
          </>
        ) : (
          <span className="text-[10px] text-ink/40 truncate">{row.error ?? 'Not a git repository'}</span>
        )}
        {row.isRepo && row.subject && (
          <>
            <span className="text-[10px] text-ink/25" aria-hidden>
              ·
            </span>
            <span className="text-[10px] text-ink/40 truncate min-w-0" title={row.subject}>
              {row.subject}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The state badges: what has to be acted on first.
 *
 * Order is by urgency — a stopped operation is a repository that cannot commit,
 * a dirty tree is one that can, an ahead/behind count is informational.
 */
function StateBadges({ row }: { row: GitRepoDetail }) {
  const badges: ComponentChild[] = [];

  if (row.operation) {
    badges.push(
      <span
        key="operation"
        className="flex flex-shrink-0 items-center gap-0.5 rounded border border-warning/30 px-1 text-[9px] font-mono text-warning"
        title={
          row.operation === 'stash-pop'
            ? `A stash pop stopped on ${row.conflicts} conflict(s)`
            : `A ${OPERATION_LABELS[row.operation]} is in progress, stopped on ${row.conflicts} conflict(s)`
        }
      >
        <AlertTriangle size={9} />
        {OPERATION_LABELS[row.operation]}
      </span>,
    );
  } else if (row.conflicts > 0) {
    badges.push(
      <span
        key="conflicts"
        className="flex flex-shrink-0 items-center gap-0.5 rounded border border-warning/30 px-1 text-[9px] font-mono text-warning"
        title={`${row.conflicts} conflicted path(s)`}
      >
        <AlertTriangle size={9} />
        {row.conflicts}
      </span>,
    );
  }

  if (row.changed > 0 || row.untracked > 0) {
    badges.push(
      <span
        key="dirty"
        className="flex-shrink-0 rounded border border-info/30 px-1 text-[9px] font-mono tabular-nums text-info"
        title={`${row.changed} changed, ${row.untracked} untracked`}
      >
        {row.changed > 0 ? `${row.changed}±` : ''}
        {row.changed > 0 && row.untracked > 0 ? ' ' : ''}
        {row.untracked > 0 ? `${row.untracked}?` : ''}
      </span>,
    );
  }

  if (row.gone) {
    badges.push(
      <span
        key="gone"
        className="flex-shrink-0 rounded border border-warning/30 px-1 text-[9px] font-mono text-warning"
        title={`${row.upstream} no longer exists on the remote — fetch --prune to drop it`}
      >
        gone
      </span>,
    );
  } else if (row.upstream && (row.ahead > 0 || row.behind > 0)) {
    badges.push(
      <span
        key="track"
        className="flex flex-shrink-0 items-center gap-0.5 text-[9px] font-mono tabular-nums text-ink/60"
        title={`${row.ahead} ahead of, ${row.behind} behind ${row.upstream}`}
      >
        {row.ahead > 0 && (
          <span className="flex items-center">
            <ArrowUp size={9} />
            {row.ahead}
          </span>
        )}
        {row.behind > 0 && (
          <span className="flex items-center">
            <ArrowDown size={9} />
            {row.behind}
          </span>
        )}
      </span>,
    );
  }

  if (badges.length === 0) {
    return (
      <span className="text-[9px] font-mono text-ink/30" title="Nothing to report — clean and in sync">
        clean, in sync
      </span>
    );
  }

  return <>{badges}</>;
}
