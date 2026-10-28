/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The subfolder listing under the New Workspace modal's location bar.
 *
 * Clicking a row ENTERS that folder — the path field follows, and that path is
 * what the workspace is created at. There is no separate "choose" action
 * because the dialog has no second destination: the directory being listed and
 * the directory being registered are the same thing, so a row can only mean
 * "go there".
 *
 * Four states are drawn and each says something different: a read in flight, a
 * failed read with its reason and a Retry, an empty directory, and the list.
 * The new-folder row is an inline field rather than a prompt because the name
 * it takes is a sibling of the rows already on screen.
 */

import type { FormEvent } from 'preact/compat';
import { CornerDownLeft, Folder, Loader2, RefreshCw, X } from 'lucide-preact';
import type { DirectoryEntry } from '@/shared/lib/fs/browse';

interface DirectoryListProps {
  directories: DirectoryEntry[];
  loading: boolean;
  error: string | null;
  /** Enter a subfolder — the path field follows. */
  onOpen: (dir: DirectoryEntry) => void;
  onRetry: () => void;
  /** True while the inline "new folder" field is showing. */
  creating: boolean;
  /**
   * The field's value and its setter are OWNED BY THE PARENT, not by this
   * component.
   *
   * They were local state reset by a `useEffect` on `creating`, and that is a
   * race the field loses: Preact runs an effect AFTER paint, so the input is
   * on screen and focusable before the reset fires — anything written into it
   * in that window (a paste, a fast first keystroke, a test harness's `fill`)
   * was silently discarded. Verified: `fill('alpha')` left the field empty and
   * the submit button disabled. Resetting in the click handler that OPENS the
   * field is synchronous and cannot race a write.
   */
  name: string;
  onNameChange: (value: string) => void;
  onCreate: (name: string) => void;
  onCancelCreate: () => void;
  createError: string | null;
  creatingBusy: boolean;
}

export function DirectoryList({
  directories,
  loading,
  error,
  onOpen,
  onRetry,
  creating,
  name,
  onNameChange,
  onCreate,
  onCancelCreate,
  createError,
  creatingBusy,
}: DirectoryListProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onCreate(name.trim());
  };

  return (
    <div className="border border-ink/15 rounded overflow-hidden">
      {creating && (
        <form
          onSubmit={submit}
          className="flex items-center space-x-1.5 px-2 py-1.5 border-b border-ink/10 bg-ink/5"
        >
          <Folder size={13} className="text-ink/40 flex-shrink-0" />
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.currentTarget.value)}
            placeholder="new-folder-name"
            aria-label="New folder name"
            spellcheck={false}
            className="flex-1 bg-paper border border-ink/20 rounded px-2 py-1 outline-none focus:border-ink/50 text-xs"
          />
          <button
            type="submit"
            disabled={creatingBusy || !name.trim()}
            className="px-2 py-1 rounded bg-ink text-canvas text-[11px] font-medium hover:bg-ink/90 disabled:opacity-40 transition-colors"
          >
            {creatingBusy ? 'Creating…' : 'Create'}
          </button>
          <button
            type="button"
            onClick={onCancelCreate}
            aria-label="Cancel new folder"
            className="p-1 rounded text-ink/40 hover:text-ink hover:bg-ink/10 transition-colors"
          >
            <X size={12} />
          </button>
        </form>
      )}
      {creating && createError && (
        <p className="px-2.5 py-1.5 text-[11px] text-error border-b border-ink/10">{createError}</p>
      )}

      <div className="max-h-52 overflow-y-auto scrollbar-overlay-container">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-ink/40">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-6 px-3 text-xs text-error space-y-2">
            <span className="text-center">{error}</span>
            <button
              type="button"
              onClick={onRetry}
              className="px-2 py-1 rounded bg-ink/5 border border-ink/10 text-ink/70 hover:bg-ink/10 flex items-center space-x-1"
            >
              <RefreshCw size={11} /> <span>Retry</span>
            </button>
          </div>
        ) : directories.length === 0 ? (
          <div className="text-center py-8 text-xs text-ink/40">No subfolders</div>
        ) : (
          directories.map((dir) => (
            <button
              key={dir.path}
              type="button"
              onClick={() => onOpen(dir)}
              title={dir.path}
              className="w-full flex items-center space-x-2 px-2.5 py-1.5 text-left hover:bg-ink/5 transition-colors group"
            >
              <Folder size={14} className="text-ink/50 flex-shrink-0" />
              <span className="text-xs truncate text-ink/85 flex-1">{dir.name}</span>
              <CornerDownLeft
                size={11}
                className="text-ink/20 group-hover:text-ink/50 flex-shrink-0 transition-colors"
              />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
