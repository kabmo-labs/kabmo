/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The New Workspace dialog, in two tabs: **Create** (name a directory that
 * already exists) and **Clone** (fetch a repository and register it in one
 * step).
 *
 * Two tabs rather than one column of six controls, because the two flows ask
 * for different things and neither is a variation of the other: Create needs a
 * name, a path and a listing to pick from; Clone needs a URL and a parent
 * directory, and produces its own name. Stacking them would have put a folder
 * browser, a git field and two submit buttons in front of a user who only ever
 * wants one of them.
 *
 * The modal owns the ONE value both tabs share: the directory being browsed.
 * In Create it is the workspace's `project_path`; in Clone it is where the
 * repository lands. They are the same directory by construction, so a folder
 * entered in one tab is the parent shown in the other — the alternative, a
 * second path state per tab, is two fields that can disagree about where the
 * user is.
 *
 * `Browse…` is deliberately still here: it opens the full `FolderPicker` for
 * deep navigation, while the inline listing covers the common case of a
 * subfolder one level down.
 */

import { useState } from 'preact/hooks';
import { FolderOpen, X } from 'lucide-preact';
import { FolderPicker } from '@/client/components/common/FolderPicker';
import { LocationBar } from '@/client/components/layout/session-sidebar/new-workspace-modal/LocationBar';
import { DirectoryList } from '@/client/components/layout/session-sidebar/new-workspace-modal/DirectoryList';
import { CloneField } from '@/client/components/layout/session-sidebar/new-workspace-modal/CloneField';
import { useDirectoryBrowse } from '@/client/components/layout/session-sidebar/new-workspace-modal/use-browse';

type Tab = 'create' | 'clone';

export interface NewWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Register a workspace for a directory that already exists. */
  onCreate?: (input: { name: string; path?: string }) => Promise<void> | void;
  /** Clone a repository and register it. Reject to keep the modal open. */
  onClone?: (input: { url: string; parent: string; name?: string }) => Promise<void> | void;
}

export function NewWorkspaceModal({ isOpen, onClose, onCreate, onClone }: NewWorkspaceModalProps) {
  // The form is MOUNTED FRESH on every open, and that is what makes its state
  // correct without a reset.
  //
  // The previous shape kept one mounted component and cleared its fields in a
  // `useEffect` keyed on `isOpen`. Preact runs effects AFTER paint, so the
  // dialog was on screen and its fields focusable before the reset landed —
  // anything written into that window was discarded. Verified in the browser:
  // a path typed into the field was wiped and the listing stayed on the home
  // directory. Mounting fresh initializes every field synchronously, before the
  // first paint, so there is no ordering question to get wrong.
  if (!isOpen) return null;
  return <NewWorkspaceForm onClose={onClose} onCreate={onCreate} onClone={onClone} />;
}

function NewWorkspaceForm({
  onClose,
  onCreate,
  onClone,
}: Omit<NewWorkspaceModalProps, 'isOpen'>) {
  const [tab, setTab] = useState<Tab>('create');
  const [name, setName] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingBusy, setCreatingBusy] = useState(false);

  const browse = useDirectoryBrowse();

  const createFolder = async (folderName: string) => {
    setCreatingBusy(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/folders/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: browse.current, name: folderName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      // The folder was made, not chosen: the listing is refreshed and the user
      // picks it, so "make a folder" and "use this folder" stay two decisions.
      setCreatingFolder(false);
      await browse.refresh();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingBusy(false);
    }
  };

  const submitCreate = async () => {
    if (!onCreate) return onClose();
    if (!name.trim() && !pathInput.trim()) {
      setError('Enter a name or a project path.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), path: pathInput.trim() || undefined });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const submitClone = async (url: string) => {
    if (!onClone) return onClose();
    if (!browse.current) {
      setError('Enter the folder the repository should be cloned into.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onClone({ url, parent: browse.current, name: name.trim() || undefined });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-ink/20 z-50 flex items-center justify-center p-4">
      <div className="bg-paper border border-ink/10 rounded-lg shadow-xl w-[30rem] max-w-full max-h-full overflow-y-auto flex flex-col">
        <div className="flex justify-between items-center px-4 pt-4 pb-2 border-b border-ink/10">
          <h3 className="font-semibold text-sm">New Workspace</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded text-ink/60 hover:text-ink hover:bg-ink/10 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex px-4 pt-2 space-x-1">
          {(['create', 'clone'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setError(null);
              }}
              aria-pressed={tab === key}
              className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                tab === key ? 'text-ink border-b-2 border-ink' : 'text-ink/50 hover:text-ink'
              }`}
            >
              {key === 'create' ? 'Create' : 'Clone'}
            </button>
          ))}
        </div>

        <div className="px-4 py-3 space-y-3 text-sm text-ink/80">
          <div>
            <label className="block text-xs font-semibold mb-1 text-ink">
              Workspace Name{' '}
              <span className="text-ink/40 font-normal">
                {tab === 'clone' ? '(optional — defaults to the repository name)' : ''}
              </span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="e.g. bofis-pro"
              className="w-full bg-paper border border-ink/20 rounded px-3 py-2 outline-none focus:border-ink/50 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1 text-ink">
              {tab === 'clone' ? 'Clone Into' : 'Project Path'}{' '}
              <span className="text-ink/40 font-normal">
                {tab === 'create' ? '(optional — binds omp sessions)' : ''}
              </span>
            </label>
            <LocationBar
              value={pathInput}
              onInput={setPathInput}
              onSubmit={() => void browse.navigate(pathInput.trim() || undefined)}
              onRefresh={() => void browse.refresh()}
              onNewFolder={() => {
                // The name is cleared HERE, in the handler that opens the field,
                // rather than in an effect inside it: an effect runs after paint,
                // so the input is on screen and focusable before the reset lands
                // and anything written in that window is discarded.
                setCreateName('');
                setCreatingFolder(true);
                setCreateError(null);
              }}
              loading={browse.loading}
              creating={creatingBusy}
              resolved={browse.current}
            />
          </div>

          <DirectoryList
            directories={browse.directories}
            loading={browse.loading}
            error={browse.error}
            onOpen={(dir) => {
              // Entering a row moves the browse path AND the field: the row
              // means "go there", and the field is what a submit reads.
              setPathInput(dir.path);
              void browse.navigate(dir.path);
            }}
            onRetry={() => void browse.refresh()}
            creating={creatingFolder}
            name={createName}
            onNameChange={setCreateName}
            onCreate={(folderName) => void createFolder(folderName)}
            onCancelCreate={() => {
              setCreatingFolder(false);
              setCreateName('');
              setCreateError(null);
            }}
            createError={createError}
            creatingBusy={creatingBusy}
          />

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="px-3 py-1.5 bg-ink/5 border border-ink/10 rounded text-xs font-medium hover:bg-ink/10 transition-colors flex items-center space-x-1.5"
            >
              <FolderOpen size={13} />
              <span>Browse…</span>
            </button>
            {browse.parentPath && (
              <button
                type="button"
                onClick={() => void browse.navigate(browse.parentPath ?? undefined)}
                className="text-[11px] text-ink/50 hover:text-ink transition-colors"
              >
                ↑ Up one level
              </button>
            )}
          </div>

          {tab === 'clone' && <CloneField parent={browse.current} busy={busy} onClone={(url) => void submitClone(url)} />}

          {error && <div className="text-xs text-error">{error}</div>}
        </div>

        <div className="px-4 py-3 border-t border-ink/10 flex justify-end space-x-2">
          <button
            type="button"
            className="px-3 py-1.5 text-xs font-medium text-ink/60 hover:text-ink transition-colors"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          {tab === 'create' && (
            <button
              type="button"
              className="px-4 py-1.5 text-xs font-medium bg-ink text-canvas rounded hover:bg-ink/90 transition-colors disabled:opacity-50"
              onClick={() => void submitCreate()}
              disabled={busy}
            >
              {busy ? 'Creating…' : 'Create Workspace'}
            </button>
          )}
        </div>
      </div>

      {pickerOpen && (
        <FolderPicker
          initialPath={pathInput || undefined}
          onSelect={(picked) => {
            setPathInput(picked);
            setPickerOpen(false);
            if (!name.trim()) {
              const base = picked.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
              if (base) setName(base);
            }
            void browse.navigate(picked);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
