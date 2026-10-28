/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Plan panel's navigation: the session's plan artifacts, newest first.
 *
 * Deliberately a list of FILES, not a table of contents. A plan is a single
 * document and the panel exists to watch the one the agent is working from, so
 * the only choice worth offering is which artifact to read — a session that has
 * been through several planning passes has several, and the newest is not
 * always the one under discussion. Section headings are drawn inside the page
 * itself, by the markdown renderer.
 */

import { useMemo, useState } from 'preact/hooks';
import { FileText, Search } from 'lucide-preact';
import type { SessionPlanFile } from '@/shared/types/plan';

interface PlanNavProps {
  files: readonly SessionPlanFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}

/** Local time of an artifact's last write; the raw epoch when unreadable. */
function formatStamp(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '';
  return new Date(epochMs).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export function PlanNav({ files, selected, onSelect }: PlanNavProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.title.toLowerCase().includes(needle));
  }, [files, query]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-canvas/40">
      <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-ink/10 px-2 py-1.5">
        <Search size={12} className="flex-shrink-0 text-ink/40" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery((event.target as HTMLInputElement).value)}
          placeholder="Filter plans…"
          aria-label="Filter plans"
          className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink/35"
        />
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto scrollbar-overlay-container"
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-ink/40 italic">
            {files.length === 0 ? 'No plan yet' : 'No plan matches the filter'}
          </p>
        ) : (
          <ul className="py-1">
            {filtered.map((file) => {
              const isActive = file.path === selected;
              const stamp = formatStamp(file.modifiedAt);
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => onSelect(file.path)}
                    aria-current={isActive ? 'true' : undefined}
                    title={`${file.path}${stamp ? ` · ${stamp}` : ''}`}
                    className={`flex w-full items-start gap-1.5 px-2.5 py-1.5 text-left transition-colors ${
                      isActive ? 'bg-ink/10 font-semibold text-ink' : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
                    }`}
                  >
                    <FileText size={12} className={`mt-0.5 flex-shrink-0 ${isActive ? 'text-ink' : 'text-ink/40'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px]">{file.title}</span>
                      {stamp && <span className="block truncate font-mono text-[10px] text-ink/40">{stamp}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
