/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel-plugin toolbar: the auto-update switch and the freshness check.
 *
 * Two controls that belong together because they act on the same question — is a
 * git-installed plugin current — from opposite directions: the check asks now,
 * the switch decides whether Kabmo keeps asking on its own.
 *
 * The checkbox states exactly what it does to the user's files. An automatic
 * update fetches a remote and hard-resets the clone, so a label reading
 * "auto-update plugins" would leave the reader to guess whether it is a check or
 * a write. It is the latter, and the sentence says so.
 */

import { ArrowDownToLine, CheckSquare, Loader2, RefreshCw, Square } from 'lucide-preact';

interface PluginToolbarProps {
  autoUpdate: boolean;
  busy: string | null;
  /** How many installed plugins are git clones — the check's own subject. */
  gitCount: number;
  /** How many installed plugins have an update waiting, from any source. */
  updateCount: number;
  onSetAutoUpdate: (enabled: boolean) => Promise<boolean>;
  onCheckUpdates: () => Promise<boolean>;
  onUpdateAll: () => Promise<boolean>;
  onRefresh: () => void;
}

export function PluginToolbar({
  autoUpdate,
  busy,
  gitCount,
  updateCount,
  onSetAutoUpdate,
  onCheckUpdates,
  onUpdateAll,
  onRefresh,
}: PluginToolbarProps) {
  const checking = busy === 'check_updates';
  const updatingAll = busy === 'update_all';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={autoUpdate}
        disabled={busy !== null}
        onClick={() => void onSetAutoUpdate(!autoUpdate)}
        title={
          autoUpdate
            ? 'Stop updating git-installed plugins automatically'
            : 'Fetch and apply the remote\u2019s latest commit for every git-installed plugin, hourly'
        }
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-ink/15 hover:bg-ink/5 disabled:opacity-50"
      >
        {autoUpdate ? <CheckSquare size={13} /> : <Square size={13} />}
        Auto-update git plugins
      </button>

      <button
        type="button"
        onClick={() => void onCheckUpdates()}
        disabled={busy !== null || gitCount === 0}
        title={
          gitCount === 0
            ? 'No git-installed plugins to check'
            : 'Ask each git-installed plugin\u2019s remote whether a newer commit exists'
        }
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-ink/15 hover:bg-ink/5 disabled:opacity-50"
      >
        <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
        Check for updates
      </button>

      {/* The count is on the button because it is the button's subject: one
          action for every waiting update, whatever the plugin's source. A
          plugin whose files were edited is refused and reported, never
          overwritten — that is what the blocked notice exists for. */}
      <button
        type="button"
        onClick={() => void onUpdateAll()}
        disabled={busy !== null || updateCount === 0}
        title={
          updateCount === 0
            ? 'No updates to apply — press Check for updates to ask the git plugins\u2019 remotes'
            : `Apply ${updateCount} update${updateCount === 1 ? '' : 's'} — a plugin with local edits is refused and reported, never overwritten`
        }
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-warning/50 text-warning hover:bg-warning/10 disabled:opacity-50"
      >
        {updatingAll ? <Loader2 size={13} className="animate-spin" /> : <ArrowDownToLine size={13} />}
        Update all{updateCount > 0 ? ` (${updateCount})` : ''}
      </button>

      <button
        type="button"
        onClick={onRefresh}
        disabled={busy !== null}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-ink/15 hover:bg-ink/5 disabled:opacity-50"
        title="Re-read the marketplace from disk"
      >
        <RefreshCw size={13} />
        Refresh
      </button>

      <span className="text-[11px] text-ink/45">
        {autoUpdate
          ? 'Git plugins are updated from their remote about once an hour, with no confirmation.'
          : 'Off — updates are applied only when you press Update.'}
      </span>
    </div>
  );
}

