/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Wait for session" — the composer's dependency pick for a NEW chat.
 *
 * Only sessions with a run in flight are offered, and that is a rule rather than
 * a filter for convenience: a prompt held on an idle session would be released
 * by the very next sweep, so the dropdown would be promising a wait that cannot
 * happen. The list is derived from the sidebar's server-tracked status map —
 * the same `stream` rows the row spinner is drawn from — so a session that
 * finished while the popup was open leaves it on the next render.
 *
 * The choice lives in the session's own UI state (`chat.waitingFor`), not in
 * this component: the composer is remounted by an expansion, a tab switch and a
 * reload, and a pick that evaporated with it would silently send the prompt
 * immediately.
 */

import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import { Hourglass, ChevronDown, Check, X } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import type { WorkspaceFolderData } from '@/shared/types';

export interface WaitingCandidate {
  id: string;
  title: string;
  folderName: string;
}

export interface WaitingDependencyPickerProps {
  folders: WorkspaceFolderData[];
  /** Server-tracked `stream` ids — the only sessions that may be waited on. */
  streamStatusMap: Record<string, string | undefined>;
  /** The session this composer writes to; never offered as its own dependency. */
  sessionId: string | null;
  /** A name for a streaming id the sidebar structure has not scanned yet. */
  titleFor?: (id: string) => string | undefined;
  value: WaitingCandidate | null;
  onChange: (candidate: WaitingCandidate | null) => void;
}

/**
 * Sessions with a run in flight, in sidebar order.
 *
 * The STATUS map is the list, and the folders are only where a name comes from.
 * That order matters: a freshly spawned session has a `stream` row the moment
 * its prompt is dispatched, while omp's transcript — which is what the sidebar
 * structure is scanned from — lands seconds later (and, in a test fixture, may
 * never land at all). Driving the list off `folder.sessions` therefore offered
 * NOTHING in the one situation the feature exists for: a run that just started.
 * Measured in `waiting-prompt.e2e.ts`, where the sidebar drew the running
 * session as a PENDING row while the folder listed no sessions at all.
 */
export function waitingCandidates(
  folders: WorkspaceFolderData[],
  streamStatusMap: Record<string, string | undefined>,
  sessionId: string | null,
  titleFor?: (id: string) => string | undefined,
): WaitingCandidate[] {
  const candidates: WaitingCandidate[] = [];
  const seen = new Set<string>();
  for (const folder of folders) {
    for (const session of folder.sessions ?? []) {
      const id = String(session.id);
      if (streamStatusMap[id] !== 'stream') continue;
      seen.add(id);
      if (sessionId && id === String(sessionId)) continue;
      candidates.push({ id, title: session.title || id, folderName: folder.name });
    }
  }
  // Streaming ids the structure has not scanned: still real runs, still
  // waitable. Named from the title hint the send path published, else the id.
  for (const [id, status] of Object.entries(streamStatusMap)) {
    if (status !== 'stream' || seen.has(id)) continue;
    if (sessionId && id === String(sessionId)) continue;
    candidates.push({ id, title: titleFor?.(id) ?? id, folderName: '' });
  }
  return candidates;
}

export function WaitingDependencyPicker({
  folders,
  streamStatusMap,
  sessionId,
  titleFor,
  value,
  onChange,
}: WaitingDependencyPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // A stable handler: the hook re-registers its document listeners whenever the
  // callback identity changes, and an inline arrow would do that on every
  // render — including every stream-status frame.
  const close = useCallback(() => setOpen(false), []);
  useOnClickOutside(ref, close);
  const candidates = useMemo(
    () => waitingCandidates(folders, streamStatusMap, sessionId, titleFor),
    [folders, streamStatusMap, sessionId, titleFor],
  );
  const unavailable = candidates.length === 0;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        data-testid="wait-picker"
        onClick={() => setOpen((prev) => !prev)}
        disabled={unavailable && !value}
        title={unavailable && !value ? 'No session is running right now' : 'Wait for another session to finish'}
        aria-label={value ? `Waiting for ${value.title}` : 'Wait for session'}
        aria-expanded={open}
        className={`group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium transition-all outline-none focus-visible:bg-ink/5 cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-50 ${
          value ? 'bg-ink/10 text-ink' : 'text-ink/75 hover:text-ink hover:bg-ink/5'
        }`}
      >
        <Hourglass size={13} className={`flex-shrink-0 ${value ? 'text-ink/80' : 'text-ink/50 group-hover:text-ink/80'}`} />
        <span className="max-w-[200px] truncate tracking-tight">
          {value ? `Wait for ${value.title}` : 'Wait for session'}
        </span>
        <ChevronDown
          size={13}
          className={`flex-shrink-0 text-ink/40 transition-transform duration-150 ${open ? 'rotate-180 text-ink/70' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 w-72 bg-paper border border-ink/10 rounded-lg shadow-lg z-50 flex flex-col overflow-hidden text-xs py-1">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-ink/5">
            <span className="text-[10px] uppercase tracking-wider text-ink/40 font-semibold">Wait for session</span>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                title="Send without waiting"
                aria-label="Send without waiting"
                className="flex items-center gap-1 text-[10px] text-ink/50 hover:text-ink cursor-pointer"
              >
                <X size={10} /> clear
              </button>
            )}
          </div>
          <div className="max-h-56 scrollbar-overlay-container py-1">
            {unavailable ? (
              <div className="px-3 py-2 text-ink/40 italic">No session is running right now</div>
            ) : (
              candidates.map((candidate) => {
                const selected = value?.id === candidate.id;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    data-testid="wait-candidate"
                    data-session-id={candidate.id}
                    onClick={() => {
                      onChange(selected ? null : candidate);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors cursor-pointer ${
                      selected ? 'bg-ink/10 text-ink font-semibold' : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate pr-2">
                      <Hourglass size={12} className={selected ? 'text-ink flex-shrink-0' : 'text-ink/50 flex-shrink-0'} />
                      <span className="truncate font-medium">{candidate.title}</span>
                      {candidate.folderName && (
                        <span className="truncate text-[10px] text-ink/40">{candidate.folderName}</span>
                      )}
                    </span>
                    {selected && <Check size={12} className="text-ink flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
