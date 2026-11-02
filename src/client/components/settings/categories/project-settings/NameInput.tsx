/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The project's name field.
 *
 * It COMMITS on blur and on Enter, and it reverts nothing on its own: the pane
 * decides whether the name was accepted (the server enforces uniqueness
 * case-insensitively) and the field follows the row it is given. Writing on
 * every keystroke — what this used to do — fired one request per character, so
 * a rename raced itself and the last response won regardless of order.
 */

import { useEffect, useState } from 'preact/hooks';

interface ProjectNameInputProps {
  name: string;
  disabled?: boolean;
  onCommit: (name: string) => void;
}

export function ProjectNameInput({ name, disabled = false, onCommit }: ProjectNameInputProps) {
  const [draft, setDraft] = useState(name);

  // The row is the truth: an accepted save trims, and a refused one reverts.
  useEffect(() => {
    setDraft(name);
  }, [name]);

  const commit = () => {
    const next = draft.trim();
    if (!next) {
      // An empty name is refused by the server; showing that as a field error
      // is better than sending a write that cannot land.
      setDraft(name);
      return;
    }
    if (next === name) return;
    onCommit(next);
  };

  return (
    <div className="space-y-2">
      <label htmlFor="project-name-input" className="block text-xs font-semibold text-ink">
        Project name
      </label>
      <input
        id="project-name-input"
        type="text"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            setDraft(name);
            e.currentTarget.blur();
          }
        }}
        placeholder="Enter project name…"
        className="w-full bg-paper border border-ink/20 rounded-md px-3 py-2 text-xs font-medium text-ink outline-none focus:border-ink/60 transition-colors shadow-2xs disabled:opacity-60"
      />
      <p className="text-[11px] text-ink/50">Names are unique — the sidebar identifies a project by it.</p>
    </div>
  );
}
