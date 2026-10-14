import { useCallback, useEffect, useState } from 'preact/hooks';
import { Archive, ChevronDown, ChevronUp, Download, Plus, Trash2 } from 'lucide-preact';
import type { GitStashEntry } from '@/shared/types/git';

interface GitStashSectionProps {
  rootPath?: string;
  repo: string;
  isBusy: boolean;
  /**
   * Runs a `stash_*` action; `extra` carries the ref / message / flags.
   *
   * A drop goes through here too and the PANEL decides whether to confirm it
   * (see `confirmRequestFor`), so this component never asks — it hands the
   * action up like every other control in the panel.
   */
  onAction: (actionType: string, extra?: Record<string, string>) => void;
}

/**
 * The stash, as a collapsed section under the commit box.
 *
 * The third-most-used verb in the agent's own session corpus (2784
 * invocations), and the natural partner of the conflict work: a conflicting
 * `git stash pop` is the ONE conflict shape that leaves no operation file, so
 * it is what `git-state.ts` names `stash-pop` and aborts with
 * `git reset --merge HEAD`.
 *
 * **Collapsed by default and its list is fetched only when opened.** The list
 * is one `git stash list` per open, not per panel refresh: the status read is
 * republished on every tool call, and a section nobody opened should cost
 * nothing. `Save` is the exception — it needs no list, so it stays available
 * while collapsed, which is where it is actually used (stash before switching
 * branches).
 *
 * `Pop` and `Apply` are both offered because the difference is not obvious from
 * the names and both are wanted: `pop` removes the entry after applying,
 * `apply` keeps it. `Drop` is destructive and says so.
 */
export function GitStashSection({ rootPath, repo, isBusy, onAction }: GitStashSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [untracked, setUntracked] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const params = new URLSearchParams({ stashes: '1', repo: repo || '.' });
    if (rootPath) params.set('root', rootPath);
    try {
      const res = await fetch(`/api/fs/git?${params.toString()}`);
      const body = await res.json() as { stashes?: GitStashEntry[] };
      setStashes(body.stashes ?? []);
    } catch {
      setStashes([]);
    } finally {
      setIsLoading(false);
    }
  }, [rootPath, repo]);

  // Re-read when the section is opened, and after any action it dispatched —
  // `isBusy` flipping back to false is the action having settled, which is the
  // one moment the list can have moved.
  useEffect(() => {
    if (expanded) void load();
  }, [expanded, load, isBusy]);

  const run = (actionType: string, extra?: Record<string, string>) => {
    onAction(actionType, extra);
    if (actionType === 'stash_push') {
      setMessage('');
      setUntracked(false);
    }
  };

  return (
    <div className="border-t border-ink/10 bg-canvas/30 flex-shrink-0">
      <div className="flex items-center px-3 py-1.5 gap-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          title={expanded ? 'Hide stashes' : 'Show stashes'}
          className="flex items-center gap-1.5 text-[11px] text-ink/70 hover:text-ink transition-colors cursor-pointer"
        >
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          <Archive size={11} />
          <span className="font-medium">Stash</span>
          {stashes.length > 0 && (
            <span className="text-[9px] border border-ink/20 rounded-full px-1.5 text-ink/50">
              {stashes.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => run('stash_push', {
            ...(message.trim() ? { message: message.trim() } : {}),
            ...(untracked ? { untracked: '1' } : {}),
          })}
          disabled={isBusy}
          title="Stash the working tree"
          className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded border border-ink/20 hover:bg-ink/5 text-ink/70 hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={10} />
          Save
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-2 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.currentTarget.value)}
              placeholder="Stash message (optional)"
              aria-label="Stash message"
              className="flex-1 min-w-0 bg-paper border border-ink/20 rounded px-2 py-1 text-[11px] text-ink placeholder-ink/40 focus:outline-none focus:border-ink/40 transition-colors font-mono"
            />
            <label
              className="flex items-center gap-1 text-[10px] text-ink/60 cursor-pointer select-none flex-shrink-0"
              title="Also stash untracked files (-u)"
            >
              <input
                type="checkbox"
                checked={untracked}
                onChange={(e) => setUntracked(e.currentTarget.checked)}
                className="accent-ink cursor-pointer"
              />
              -u
            </label>
          </div>

          {isLoading && stashes.length === 0 ? (
            <div className="text-[10px] text-ink/40 italic py-1">Loading…</div>
          ) : stashes.length === 0 ? (
            <div className="text-[10px] text-ink/40 italic py-1">No stash entries.</div>
          ) : (
            <div className="max-h-40 overflow-y-auto scrollbar-overlay-container scrollbar-overlay-static flex flex-col">
              {stashes.map((entry) => (
                // Grid, not flex: the date column is a fixed track so its left
                // edge is the same in every row. As a flex child it sized to its
                // own text, so `just now` and `11m ago` started at different x
                // and the column read as ragged down the list.
                <div
                  key={entry.ref}
                  className="grid grid-cols-[4rem_minmax(0,1fr)_3.5rem_4.5rem] items-center gap-x-1 group/stash py-0.5"
                >
                  <span className="text-[10px] font-mono text-ink/50 truncate">{entry.ref}</span>
                  <span className="min-w-0 truncate text-[10px] text-ink/80" title={entry.subject}>
                    {entry.subject}
                  </span>
                  <span className="text-[9px] text-ink/40 text-right truncate">{entry.date}</span>
                  <div className="flex items-center justify-end gap-0.5 touch-visible opacity-0 group-hover/stash:opacity-100">
                    <button
                      type="button"
                      onClick={() => run('stash_apply', { ref: entry.ref, pop: '1' })}
                      disabled={isBusy}
                      title="Pop — apply and remove the entry"
                      aria-label="Pop stash"
                      className="w-5 h-5 flex items-center justify-center rounded hover:text-ink hover:bg-ink/10 cursor-pointer transition-colors disabled:opacity-40"
                    >
                      <Download size={10} />
                    </button>
                    <button
                      type="button"
                      onClick={() => run('stash_apply', { ref: entry.ref })}
                      disabled={isBusy}
                      title="Apply — keep the entry"
                      aria-label="Apply stash"
                      className="w-5 h-5 flex items-center justify-center rounded hover:text-ink hover:bg-ink/10 cursor-pointer transition-colors disabled:opacity-40"
                    >
                      <Archive size={10} />
                    </button>
                    <button
                      type="button"
                      onClick={() => run('stash_drop', { ref: entry.ref })}
                      disabled={isBusy}
                      title="Drop — discard the entry (the stash is not recoverable from the panel)"
                      aria-label="Drop stash"
                      className="w-5 h-5 flex items-center justify-center rounded hover:text-error hover:bg-error/10 cursor-pointer transition-colors disabled:opacity-40"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
