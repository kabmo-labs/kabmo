/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The New Workspace modal's location bar: the path being browsed, plus the
 * three controls that act on it — go to the typed path, refresh the listing,
 * and create a subfolder.
 *
 * The three sit together because they act on ONE value. The refresh button and
 * the new-folder button are inside the field's own group rather than beside it
 * so it is unambiguous that they read the path the field shows, not the
 * workspace name above it.
 *
 * The refresh icon spins for the duration of its own read, so the click has a
 * visible end; `aria-busy` carries the same fact to a screen reader.
 */

import type { FormEvent } from 'preact/compat';
import { FolderPlus, Home, Loader2, RefreshCw } from 'lucide-preact';

interface LocationBarProps {
  value: string;
  onInput: (value: string) => void;
  /** Commit the typed path as the directory to list. */
  onSubmit: () => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  /** A listing read is in flight. */
  loading: boolean;
  /** True while a new folder is being created. */
  creating: boolean;
  /** The directory the listing came from — shown when the field differs. */
  resolved: string;
}

export function LocationBar({
  value,
  onInput,
  onSubmit,
  onRefresh,
  onNewFolder,
  loading,
  creating,
  resolved,
}: LocationBarProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div>
      <div className="flex items-center space-x-2">
        <form
          onSubmit={submit}
          className="flex-1 flex items-center bg-paper border border-ink/20 rounded overflow-hidden focus-within:border-ink/50"
        >
          <div className="px-2 text-ink/40 bg-ink/5 h-full flex items-center border-r border-ink/10">
            <Home size={14} />
          </div>
          <input
            type="text"
            value={value}
            onChange={(e) => onInput(e.currentTarget.value)}
            placeholder="~/projects/my-project"
            spellcheck={false}
            aria-label="Project path"
            className="w-full px-3 py-2 outline-none text-sm bg-transparent font-mono"
          />
        </form>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh folders"
          aria-label="Refresh folders"
          aria-busy={loading}
          className="px-2.5 py-2 bg-ink/5 border border-ink/10 rounded text-ink/70 hover:bg-ink/10 hover:text-ink disabled:opacity-40 transition-colors flex-shrink-0"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
        </button>
        <button
          type="button"
          onClick={onNewFolder}
          disabled={creating || loading || !resolved}
          title="New folder here"
          aria-label="New folder here"
          aria-busy={creating}
          className="px-2.5 py-2 bg-ink/5 border border-ink/10 rounded text-ink/70 hover:bg-ink/10 hover:text-ink disabled:opacity-40 transition-colors flex-shrink-0"
        >
          {creating ? <Loader2 size={13} className="animate-spin" /> : <FolderPlus size={13} />}
        </button>
      </div>
      {resolved && resolved !== value.trim() && (
        <p className="mt-1 text-[10px] text-ink/40 font-mono truncate">Listing: {resolved}</p>
      )}
    </div>
  );
}
