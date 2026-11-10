/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Parent session" — which session a NEW chat branches under.
 *
 * The composer's draft-target row already answers where a chat runs; this is
 * the other half of the same question for a child: what it runs UNDER. The
 * list is ALL real sessions, not only the active one, because the row that
 * opened the composer may not be the parent the user ends up wanting.
 *
 * A pending chat is never offered (it has no id to parent), and neither is an
 * archived one (the server refuses to spawn under it).
 */

import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, GitBranch, X } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import type { WorkspaceFolderData } from '@/shared/types';

export interface ParentSessionOption {
  id: string;
  title: string;
  folderId: number | string;
  folderName: string;
  harness?: string;
}

/** Every real session, in sidebar order, excluding the chat being composed. */
export function parentSessionOptions(
  folders: WorkspaceFolderData[],
  excludeId?: string | null,
): ParentSessionOption[] {
  const options: ParentSessionOption[] = [];
  for (const folder of folders) {
    for (const session of folder.sessions ?? []) {
      const id = String(session.id);
      if (id.startsWith('new-') || session.is_archived === 1) continue;
      if (excludeId && id === excludeId) continue;
      options.push({
        id,
        title: session.title || id,
        folderId: folder.id,
        folderName: folder.name,
        ...(session.harness ? { harness: session.harness } : {}),
      });
    }
  }
  return options;
}

export interface ParentSessionPickerProps {
  folders: WorkspaceFolderData[];
  /** The pending chat itself, never offered as its own parent. */
  sessionId?: string | null;
  value: string | null;
  onChange: (sessionId: string | null) => void;
  /** "Parent session" for a child, "Fork from" for a fork. */
  label?: string;
  /** False when the pending chat MUST have a source (a fork). */
  allowNone?: boolean;
}

export function ParentSessionPicker({
  folders,
  sessionId,
  value,
  onChange,
  label = 'Parent session',
  allowNone = true,
}: ParentSessionPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOnClickOutside(ref, close);
  const options = useMemo(() => parentSessionOptions(folders, sessionId), [folders, sessionId]);
  const selected = value ? options.find((option) => option.id === value) : undefined;
  const triggerLabel = selected ? selected.title : value ? value : `${label}: none`;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        data-testid="parent-session-picker"
        onClick={() => setOpen((prev) => !prev)}
        title={selected ? `${label}: ${selected.title}` : `Choose a session for ${label.toLowerCase()}`}
        aria-label={selected ? `${label}: ${selected.title}` : label}
        aria-expanded={open}
        className={`tap-chip group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium transition-all focus-visible:bg-ink/5 cursor-pointer select-none ${
          selected ? 'bg-ink/10 text-ink' : 'text-ink/75 hover:text-ink hover:bg-ink/5'
        }`}
      >
        <GitBranch size={13} className={`flex-shrink-0 ${selected ? 'text-ink/80' : 'text-ink/50 group-hover:text-ink/80'}`} />
        <span className="max-w-[220px] truncate tracking-tight">{triggerLabel}</span>
        <ChevronDown
          size={13}
          className={`flex-shrink-0 text-ink/40 transition-transform duration-150 ${open ? 'rotate-180 text-ink/70' : ''}`}
        />
      </button>

      {open && (
        <div className="glass-popover absolute bottom-full left-0 mb-1.5 w-80 bg-paper border border-ink/10 rounded-lg shadow-lg z-50 flex flex-col overflow-hidden text-xs py-1">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-ink/5">
            <span className="text-[10px] uppercase tracking-wider text-ink/40 font-semibold">
              {label}
            </span>
            {value && allowNone && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                title="Start a top-level chat"
                aria-label="Clear parent session"
                className="flex items-center gap-1 text-[10px] text-ink/50 hover:text-ink cursor-pointer"
              >
                <X size={10} /> clear
              </button>
            )}
          </div>
          <div className="max-h-64 scrollbar-overlay-container py-1">
            {allowNone && (
              <button
                type="button"
                data-testid="parent-candidate-none"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer hover:bg-ink/5 ${
                  value ? 'text-ink/70' : 'text-ink font-medium'
                }`}
              >
                <span className="w-3 shrink-0">{!value && <Check size={11} />}</span>
                <span className="min-w-0 flex-1 truncate">No parent (top-level chat)</span>
              </button>
            )}
            {options.map((option) => {
              const active = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  data-testid="parent-candidate"
                  data-session-id={option.id}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer hover:bg-ink/5 ${
                    active ? 'text-ink font-medium' : 'text-ink/70'
                  }`}
                >
                  <span className="w-3 shrink-0">{active && <Check size={11} />}</span>
                  <span className="min-w-0 flex-1 truncate">{option.title}</span>
                  <span className="shrink-0 max-w-[7rem] truncate text-[10px] text-ink/40">
                    {option.folderName}
                  </span>
                </button>
              );
            })}
            {options.length === 0 && (
              <div className="px-3 py-2 text-ink/40 italic">No sessions to parent under yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
