/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The project's directory: one editable path, a Browse… picker, a Reveal
 * action, and the state of the binding.
 *
 * The path used to be read-only text in the header, so a workspace bound to the
 * wrong directory (or created before the directory existed) had to be deleted
 * and re-created — losing its chats. It is editable here, committed on Enter or
 * blur, and `~` is expanded server-side exactly like the New Workspace dialog.
 *
 * A folder that is NOT bound is a first-class state, not an error: it groups
 * chats with no omp project behind it, and the field says so.
 */

import { useEffect, useState } from 'preact/hooks';
import { FolderOpen, Pencil } from 'lucide-preact';
import { FolderPicker } from '@/client/components/common/FolderPicker';

interface ProjectPathFieldProps {
  path: string;
  disabled?: boolean;
  onCommit: (path: string) => void;
  /** Reveal the bound directory in the OS file manager. */
  onReveal?: () => void;
  /** True while the reveal request is in flight. */
  isRevealing?: boolean;
}

export function ProjectPathField({
  path,
  disabled = false,
  onCommit,
  onReveal,
  isRevealing = false,
}: ProjectPathFieldProps) {
  const [draft, setDraft] = useState(path);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  useEffect(() => {
    setDraft(path);
  }, [path]);

  const commit = (next: string) => {
    const trimmed = next.trim();
    if (trimmed === path) return;
    onCommit(trimmed);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="project-path-input" className="block text-xs font-semibold text-ink">
          Project directory
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsPickerOpen(true)}
            disabled={disabled}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-ink/20 hover:border-ink/40 text-[11px] font-medium text-ink transition-colors cursor-pointer disabled:opacity-50"
          >
            <Pencil size={11} />
            <span>Browse…</span>
          </button>
          <button
            type="button"
            onClick={onReveal}
            disabled={disabled || !path || isRevealing}
            title={path ? 'Reveal in the file manager' : 'This project is not bound to a directory'}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-ink/20 hover:border-ink/40 text-[11px] font-medium text-ink transition-colors cursor-pointer disabled:opacity-40"
          >
            <FolderOpen size={11} />
            <span>Reveal</span>
          </button>
        </div>
      </div>

      <input
        id="project-path-input"
        type="text"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            setDraft(path);
            e.currentTarget.blur();
          }
        }}
        placeholder="~ or /absolute/path, or leave empty for an unbound grouping"
        spellcheck={false}
        className="w-full bg-paper border border-ink/20 rounded-md px-3 py-2 text-[11.5px] font-mono text-ink outline-none focus:border-ink/60 transition-colors shadow-2xs disabled:opacity-60"
      />
      <p className="text-[11px] text-ink/50">
        {path
          ? 'Sessions found under this directory appear in the project. One directory can belong to one project.'
          : 'Not bound to a directory: this project groups chats only and discovers no sessions.'}
      </p>

      {isPickerOpen && (
        <FolderPicker
          initialPath={path || undefined}
          onSelect={(picked) => {
            setIsPickerOpen(false);
            setDraft(picked);
            commit(picked);
          }}
          onClose={() => setIsPickerOpen(false)}
        />
      )}
    </div>
  );
}
