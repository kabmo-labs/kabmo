/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Wait for session" — the composer's dependency pick.
 *
 * Two mounts, one control: the draft row above a chat that has not started, and
 * the composer header of a chat that already has a session (the NEXT prompt).
 * Only
 * sessions with a run in flight are offered, and that is a rule rather than a
 * filter for convenience: a prompt held on an idle session would be released
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
import { AnchoredMenu } from '@/client/components/common/anchored-menu';
import { anchorRectOf, type AnchorRect } from '@/shared/lib/ui/menu-anchor';
import { PickerSearch } from '@/client/components/common/picker-search';
import { matchesPickerQuery } from '@/shared/lib/ui/picker-filter';
import type { WorkspaceFolderData } from '@/shared/types';

export interface WaitingCandidate {
  id: string;
  title: string;
  folderName: string;
}

export interface WaitingDependencyPickerProps {
  /** Sessions that may be waited on, from `waitingCandidates`. */
  candidates: WaitingCandidate[];
  value: WaitingCandidate | null;
  onChange: (candidate: WaitingCandidate | null) => void;
  /** Toolbar mount: the label collapses on a narrow composer. */
  compactLabel?: boolean;
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
  candidates,
  value,
  onChange,
  compactLabel = false,
}: WaitingDependencyPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // The trigger's viewport rectangle, measured when the menu opens. The panel
  // is portalled and `fixed`, so its position comes from `placeMenu` — CSS
  // alone cannot see the window's edges, and the header row sits at the bottom
  // of a desktop viewport (and the top of a stretched phone one), so a fixed
  // `top-full`/`bottom-full` ran off the screen in one of the two.
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setAnchor(null);
  }, []);
  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    setAnchor(anchorRectOf(trigger));
    setOpen(true);
  };
  const unavailable = candidates.length === 0;
  const visible = useMemo(
    () => candidates.filter((candidate) => matchesPickerQuery(`${candidate.title} ${candidate.folderName}`, query)),
    [candidates, query],
  );

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-testid="wait-picker"
        onClick={toggle}
        disabled={unavailable && !value}
        title={unavailable && !value ? 'No session is running right now' : 'Wait for another session to finish'}
        aria-label={value ? `Waiting for ${value.title}` : 'Wait for session'}
        aria-expanded={open}
        className={`tap-chip group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium transition-all focus-visible:bg-ink/5 cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-50 ${
          value ? 'bg-ink/10 text-ink' : 'text-ink/75 hover:text-ink hover:bg-ink/5'
        }`}
      >
        <Hourglass size={13} className={`flex-shrink-0 ${value ? 'text-ink/80' : 'text-ink/50 group-hover:text-ink/80'}`} />
        <span className={`max-w-[200px] truncate tracking-tight ${compactLabel ? 'hidden @[520px]:inline' : ''}`}>
          {value ? `Wait for ${value.title}` : 'Wait for session'}
        </span>
        <ChevronDown
          size={13}
          className={`flex-shrink-0 text-ink/40 transition-transform duration-150 ${open ? 'rotate-180 text-ink/70' : ''}`}
        />
      </button>

      <AnchoredMenu
        anchor={open ? anchor : null}
        ariaLabel="Wait for session"
        // `max-w` is the horizontal half of the viewport clamp: `placeMenu`
        // pins the panel's left edge inside the window, but a panel wider than
        // the window would still run past the right one. 1rem is the two 8px
        // margins it keeps.
        className="w-max min-w-[16rem] max-w-[calc(100vw-1rem)] bg-paper border border-ink/10 rounded-lg shadow-lg flex flex-col text-xs py-1"
        onClose={close}
      >
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-ink/5">
          <span className="text-[10px] uppercase tracking-wider text-ink/40 font-semibold">Wait for session</span>
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                close();
              }}
              title="Send without waiting"
              aria-label="Send without waiting"
              className="flex items-center gap-1 text-[10px] text-ink/50 hover:text-ink cursor-pointer"
            >
              <X size={10} /> clear
            </button>
          )}
        </div>
        {!unavailable && (
          <PickerSearch value={query} onChange={setQuery} ariaLabel="Search running sessions" placeholder="Search sessions…" />
        )}
        <div className="max-h-56 scrollbar-overlay-container py-1">
          {unavailable ? (
            <div className="px-3 py-2 text-ink/40 italic">No session is running right now</div>
          ) : visible.length === 0 ? (
            <div className="px-3 py-2 text-ink/40 italic">No match for “{query.trim()}”</div>
          ) : (
            visible.map((candidate) => {
              const selected = value?.id === candidate.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  data-testid="wait-candidate"
                  data-session-id={candidate.id}
                  onClick={() => {
                    onChange(selected ? null : candidate);
                    close();
                  }}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors cursor-pointer ${
                    selected ? 'bg-ink/10 text-ink font-semibold' : 'text-muted hover:bg-ink/5 hover:text-ink'
                  }`}
                >
                  <Hourglass size={12} className={selected ? 'text-ink shrink-0' : 'text-ink/50 shrink-0'} />
                  <span className="min-w-0 max-w-[15rem] flex-1 truncate font-medium">{candidate.title}</span>
                  {candidate.folderName && (
                    // The folder is the DISAMBIGUATOR between two sessions
                    // with the same title, so it is pinned to the row's RIGHT
                    // edge where the column can be scanned, and the popover is
                    // sized to it (`w-max`) so the title is the item that
                    // yields. It only ellipsises once the panel hits its
                    // viewport cap, where truncation beats overflowing.
                    <span
                      title={candidate.folderName}
                      className="ml-auto min-w-0 truncate text-[10px] text-ink/40"
                    >
                      {candidate.folderName}
                    </span>
                  )}
                  {/* A fixed slot, not a conditional glyph: a selected row
                      would otherwise shift every folder label 20px left of
                      the column the other rows sit in. */}
                  <span className="w-3 shrink-0">{selected && <Check size={12} className="text-ink" />}</span>
                </button>
              );
            })
          )}
        </div>
      </AnchoredMenu>
    </div>
  );
}
