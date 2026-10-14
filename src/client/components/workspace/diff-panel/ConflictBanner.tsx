import { AlertTriangle } from 'lucide-preact';
import type { ConflictMarkers } from '@/shared/lib/fs/git-unmerged';

interface ConflictBannerProps {
  /** The side labels read from the file's own markers. */
  markers: ConflictMarkers;
  isBusy: boolean;
  error?: string | null;
  onResolve: (side: 'ours' | 'theirs' | '') => void;
  onDismissError: () => void;
}

/**
 * The strip the diff panel shows when the file it is displaying is CONFLICTED.
 *
 * `fetchWorkingFileDiff` already returns git's combined diff for such a file
 * (`diff --cc`, `@@@`) and `parseUnifiedDiff` renders it — measured, the
 * `<<<<<<<`/`=======`/`>>>>>>>` markers come through as ordinary add/context
 * rows. What was missing is that the panel did not know it was looking at a
 * conflict: the toolbar read `M`/`U` through the plain status rules and the only
 * resolve affordance was in the change list.
 *
 * **The two side buttons are labelled from the file's own markers.** `git
 * checkout --ours` / `--theirs` are inverted during a rebase (measured), so a
 * button labelled "ours" that runs `--ours` silently takes the other side in
 * half the conflict states — the labels have to name what the reader sees.
 */
export function ConflictBanner({ markers, isBusy, error, onResolve, onDismissError }: ConflictBannerProps) {
  const oursLabel = markers.ours || 'ours';
  const theirsLabel = markers.theirs || 'theirs';

  return (
    <div className="flex-shrink-0 border-b border-warning/30 bg-warning/5">
      <div className="flex items-center gap-2 px-3 py-1.5 flex-wrap">
        <AlertTriangle size={13} className="text-warning flex-shrink-0" />
        <span className="text-[11px] font-medium text-warning">Conflicted file</span>

        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <button
            type="button"
            onClick={() => onResolve('ours')}
            disabled={isBusy}
            title={`Take ${oursLabel} — \`git checkout --ours\` then stage`}
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-ink/20 hover:bg-ink/5 text-ink/80 hover:text-ink transition-colors cursor-pointer disabled:opacity-40 max-w-[40%] truncate"
          >
            take {oursLabel}
          </button>
          <button
            type="button"
            onClick={() => onResolve('theirs')}
            disabled={isBusy}
            title={`Take ${theirsLabel} — \`git checkout --theirs\` then stage`}
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-ink/20 hover:bg-ink/5 text-ink/80 hover:text-ink transition-colors cursor-pointer disabled:opacity-40 max-w-[40%] truncate"
          >
            take {theirsLabel}
          </button>
          <button
            type="button"
            onClick={() => onResolve('')}
            disabled={isBusy}
            title="Mark resolved — the file was edited by hand, this stages it"
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-ink/20 hover:bg-ink/5 text-ink/80 hover:text-ink transition-colors cursor-pointer disabled:opacity-40"
          >
            mark resolved
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-1 border-t border-error/25 bg-error/10 text-[10px] text-error">
          <span className="min-w-0 flex-1 truncate" title={error}>{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="px-1 rounded hover:bg-error/15 cursor-pointer"
            title="Dismiss"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
