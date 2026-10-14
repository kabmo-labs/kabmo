import { useState } from 'preact/hooks';
import { Check, ChevronDown, ChevronUp, FileWarning } from 'lucide-preact';
import { FileIcon } from '@/client/components/common/file-icon';
import { isUnmergedCode } from '@/shared/lib/fs/git-unmerged';
import type { GitChange } from '@/shared/types';
import type { ConflictMarkers } from '@/shared/lib/fs/git-unmerged';

interface GitConflictItemProps {
  change: GitChange;
  repo?: string;
  rootPath?: string;
  /** Runs `resolve_conflict` with the given side (`''` = mark resolved). */
  onResolve: (file: string, side: 'ours' | 'theirs' | '') => void;
}

/**
 * One conflicted path, with the actions that resolve it.
 *
 * **The two side buttons are labelled from the file's OWN conflict markers,
 * never with the words ours/theirs.** `git checkout --ours` / `--theirs` are
 * inverted during a rebase — measured on the same two commits, a merge
 * conflict's `--ours` yields the branch you are on while a rebase conflict's
 * `--ours` yields the branch being rebased ONTO — so a button labelled "ours"
 * that runs `--ours` silently takes the other side in half the conflict states.
 * The labels are read from the `<<<<<<<` / `>>>>>>>` lines git itself wrote, so
 * they name what the reader sees in the file, and the markers are fetched only
 * when this row's menu is opened (a read per conflict per panel refresh would
 * be a file read per publish).
 *
 * `Mark resolved` is the `git add` git's own hint asks for: the file was
 * resolved in the editor and only the index needs to hear about it.
 */
export function GitConflictItem({ change, repo, rootPath, onResolve }: GitConflictItemProps) {
  const [open, setOpen] = useState(false);
  const [markers, setMarkers] = useState<ConflictMarkers | null>(null);

  const parts = change.file.split('/');
  const fileName = parts.pop() || change.file;
  const dirPath = parts.length > 0 ? parts.join('/') : '';

  const openDiff = () => {
    window.dispatchEvent(new CustomEvent('omp:open-diff', {
      detail: { file: change.file, staged: false, status: change.status, repo, root: rootPath },
    }));
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && markers === null) {
      const params = new URLSearchParams({ conflictMarkers: '1', file: change.file, repo: repo || '.' });
      if (rootPath) params.set('root', rootPath);
      try {
        const res = await fetch(`/api/fs/git?${params.toString()}`);
        const body = await res.json() as { markers?: ConflictMarkers };
        setMarkers(body.markers ?? {});
      } catch {
        // A failed read leaves the buttons on their generic labels rather than
        // hiding them: the actions still work, only the naming is less precise.
        setMarkers({});
      }
    }
  };

  // The labels: git's own marker text, or the fallback when the read has not
  // landed (or the file has no markers — a binary conflict, a delete/modify).
  const oursLabel = markers?.ours || 'ours';
  const theirsLabel = markers?.theirs || 'theirs';

  return (
    <div className="border-b border-warning/20 last:border-b-0">
      <div
        className="flex items-center justify-between px-3 py-1 hover:bg-warning/5 cursor-pointer group text-[11px] transition-colors"
        onClick={openDiff}
      >
        <div className="flex items-center space-x-1.5 flex-1 min-w-0 pr-2">
          <FileWarning size={11} className="text-warning flex-shrink-0" />
          <FileIcon name={fileName} size={12} className="flex-shrink-0" />
          <span className="truncate text-warning" title={change.file}>{fileName}</span>
          {dirPath && <span className="text-[9px] text-ink/40 truncate ml-1">{dirPath}</span>}
          {isUnmergedCode(change.status) && (
            <span className="text-[9px] text-warning/70 font-mono flex-shrink-0">{change.status}</span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void toggle(); }}
          title={open ? 'Hide resolve actions' : 'Show resolve actions'}
          aria-label={open ? 'Hide resolve actions' : 'Show resolve actions'}
          aria-expanded={open}
          className="w-5 h-5 flex items-center justify-center rounded text-ink/40 hover:text-ink hover:bg-ink/10 cursor-pointer transition-colors flex-shrink-0"
        >
          {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      {open && (
        <div className="px-3 pb-2 pt-0.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onResolve(change.file, 'ours')}
            title={`Take ${oursLabel} — \`git checkout --ours\` then stage`}
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-ink/20 hover:bg-ink/5 text-ink/80 hover:text-ink transition-colors cursor-pointer max-w-[45%] truncate"
          >
            take {oursLabel}
          </button>
          <button
            type="button"
            onClick={() => onResolve(change.file, 'theirs')}
            title={`Take ${theirsLabel} — \`git checkout --theirs\` then stage`}
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-ink/20 hover:bg-ink/5 text-ink/80 hover:text-ink transition-colors cursor-pointer max-w-[45%] truncate"
          >
            take {theirsLabel}
          </button>
          <button
            type="button"
            onClick={() => onResolve(change.file, '')}
            title="Mark resolved — the file was edited by hand, this stages it"
            className="px-2 py-0.5 text-[10px] font-mono rounded border border-ink/20 hover:bg-ink/5 text-ink/80 hover:text-ink transition-colors cursor-pointer flex items-center gap-1"
          >
            <Check size={10} />
            mark resolved
          </button>
        </div>
      )}
    </div>
  );
}
