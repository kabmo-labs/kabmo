/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Add project" inside Settings → Projects.
 *
 * The plus button used to POST `{ name: "Project 2" }` — an unbound folder with
 * a generated name and no directory — which then listed no sessions and could
 * not be pointed at a directory from this pane either. It now asks for the two
 * facts a workspace actually needs (a name and a directory), pre-filling the
 * name from the directory the way the New Workspace dialog does, and refuses
 * before the request when either is missing.
 *
 * The directory is OPTIONAL on purpose: an unbound workspace is a legitimate
 * grouping for chats with no omp project behind them, and the dialog says so
 * instead of pretending the field is required.
 */

import { useState } from 'preact/hooks';
import { FolderOpen, Loader2 } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { FolderPicker } from '@/client/components/common/FolderPicker';

interface AddProjectModalProps {
  isOpen: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; path: string }) => Promise<void>;
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return (trimmed.split(/[\\/]/).pop() ?? '').toLowerCase();
}

function AddProjectForm({ isSaving, onClose, onSubmit }: Omit<AddProjectModalProps, 'isOpen'>) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  // True while the name is still the one derived from a picked directory: a
  // later pick may overwrite it, a typed name may not.
  const [nameFromPath, setNameFromPath] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const chooseDirectory = (picked: string) => {
    setPath(picked);
    if (nameFromPath || !name.trim()) {
      setName(baseName(picked));
      setNameFromPath(true);
    }
  };

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Enter a project name.');
      return;
    }
    setError(null);
    try {
      await onSubmit({ name: trimmedName, path: path.trim() });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <>
      <Modal
        onClose={isSaving ? () => {} : onClose}
        ariaLabel="Add project"
        maxWidthClass="max-w-[480px]"
        header={
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Add project</h2>
            <p className="text-[11px] text-ink/50">A name, and the directory its chats run in.</p>
          </div>
        }
        footer={
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-ink/10">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-md border border-ink/20 text-xs font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-md bg-ink text-canvas text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {isSaving && <Loader2 size={13} className="animate-spin" />}
              <span>{isSaving ? 'Adding…' : 'Add project'}</span>
            </button>
          </div>
        }
      >
        <div className="px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="add-project-name" className="block text-xs font-semibold text-ink">
              Name
            </label>
            <input
              id="add-project-name"
              type="text"
              value={name}
              onInput={(e) => {
                setName(e.currentTarget.value);
                setNameFromPath(false);
              }}
              placeholder="e.g. kabmo"
              className="w-full bg-paper border border-ink/20 rounded-md px-3 py-2 text-xs text-ink outline-none focus:border-ink/60 transition-colors"
            />
            <p className="text-[11px] text-ink/50">Unique — the sidebar identifies a workspace by it.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="add-project-path" className="block text-xs font-semibold text-ink">
              Directory <span className="text-ink/40 font-normal">(optional)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="add-project-path"
                type="text"
                value={path}
                onInput={(e) => setPath(e.currentTarget.value)}
                placeholder="~ or /absolute/path"
                spellcheck={false}
                className="flex-1 min-w-0 bg-paper border border-ink/20 rounded-md px-3 py-2 text-[11.5px] font-mono text-ink outline-none focus:border-ink/60 transition-colors"
              />
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 rounded-md border border-ink/20 hover:border-ink/40 text-[11px] font-medium text-ink transition-colors cursor-pointer"
              >
                <FolderOpen size={12} />
                <span>Browse…</span>
              </button>
            </div>
            <p className="text-[11px] text-ink/50">
              Sessions under this directory are listed in the project. Leave it empty for a grouping with no directory
              behind it.
            </p>
          </div>

          {error && <p className="text-[11px] text-error">{error}</p>}
        </div>

        {pickerOpen && (
          <FolderPicker
            initialPath={path || undefined}
            onSelect={(picked) => {
              chooseDirectory(picked);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}

export function AddProjectModal({ isOpen, isSaving, onClose, onSubmit }: AddProjectModalProps) {
  // Mounted fresh per open, so every field starts from its own value with no
  // reset effect to race the first paint (same reason as NewWorkspaceModal).
  if (!isOpen) return null;
  return <AddProjectForm isSaving={isSaving} onClose={onClose} onSubmit={onSubmit} />;
}
