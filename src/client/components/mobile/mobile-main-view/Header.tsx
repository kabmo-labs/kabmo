import { useMemo, useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, Loader2, Menu, PanelRight, Plus } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { getLastOpenedAt } from '@/shared/lib/workspace/session-state/store';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { useAgentStreamStatus } from '@/client/hooks/chat/omp/status';
import { useSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import { StreamStatusDot } from '@/client/components/common/StreamStatusDot';
import { ReloadPageButton } from '@/client/components/common/ReloadPageButton';
import { ContextUsageButton } from '@/client/components/common/context-usage-button';

interface MobileHeaderProps {
  activeSessionTitle: string;
  activeSessionId: number | string | null;
  onOpenSessionSidebar: () => void;
  onOpenRightSidebar: () => void;
  onNewSession: () => void;
  onSelectSession: (id: number | string) => void;
}

interface RecentSession {
  id: number | string;
  title: string;
  folderName: string;
  /** Sort key: the user's last-open time when within the window, else the
   *  session file's modification time. */
  modified: number;
}

const MAX_RECENT_SESSIONS = 10;
/** A session is "recent" only while the user opened it within this window
 *  (mirrors the session-state store's idle TTL). */
const RECENT_OPEN_WINDOW_MS = 10 * 60 * 1000;

export function MobileHeader({
  activeSessionTitle,
  activeSessionId,
  onOpenSessionSidebar,
  onOpenRightSidebar,
  onNewSession,
  onSelectSession,
}: MobileHeaderProps) {
  const { folders } = useSidebarData();
  const streamStatus = useAgentStreamStatus();
  // The drawer's row spins from the same store, so the two surfaces cannot
  // disagree about whether a rename is running.
  const renaming = useSessionRenaming(activeSessionId);
  const [showSessionPicker, setShowSessionPicker] = useState(false);

  const sessionPickerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(sessionPickerRef, () => setShowSessionPicker(false));

  // Recent sessions: archived rows are hidden. A session the user actually
  // opened in this tab within the last 10 minutes ranks by that open time
  // ("last opened by user"); sessions never opened here fall back to file
  // modification time so the picker is never empty on a fresh tab, and rows
  // whose open is older than the window drop out of the list.
  const recentSessions = useMemo<RecentSession[]>(() => {
    const now = Date.now();
    const rows: RecentSession[] = [];
    for (const folder of folders) {
      for (const session of folder.sessions ?? []) {
        if (session.is_archived === 1) continue;
        const lastOpenedAt = getLastOpenedAt(String(session.id));
        const modified = session.updated_at ? Date.parse(session.updated_at) : 0;
        // Within the window: the open time is the ranking key. Without a
        // recorded open, keep the row only if the file is itself recent.
        const sortKey = lastOpenedAt !== undefined && now - lastOpenedAt <= RECENT_OPEN_WINDOW_MS
          ? lastOpenedAt
          : modified;
        if (lastOpenedAt !== undefined && now - lastOpenedAt > RECENT_OPEN_WINDOW_MS) continue;
        rows.push({
          id: session.id,
          title: session.title,
          folderName: folder.name,
          modified: sortKey,
        });
      }
    }
    return rows
      .sort((a, b) => b.modified - a.modified)
      .slice(0, MAX_RECENT_SESSIONS);
  }, [folders]);

  const displayTitle = activeSessionTitle
    ? activeSessionTitle.charAt(0).toUpperCase() + activeSessionTitle.slice(1)
    : 'New session';

  return (
    <header
      className="flex-shrink-0 bg-canvas border-b border-ink/10 flex items-center justify-between px-3 z-20 titlebar-drag-region select-none"
      style={{
        height: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px), env(titlebar-area-x, 0px))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px), calc(100vw - env(titlebar-area-width, 100vw)))',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* Left: hamburger, app title & session dropdown */}
      <div className="flex items-center space-x-2 min-w-0 titlebar-no-drag">
        <button
          type="button"
          onClick={onOpenSessionSidebar}
          className="p-1.5 rounded-lg hover:bg-ink/5 active:bg-ink/10 text-ink transition-colors flex-shrink-0"
          title="Open Sessions"
          aria-label="Open Sessions"
        >
          <Menu size={20} strokeWidth={2} />
        </button>

        <span className="relative font-bold text-sm tracking-tight flex items-center flex-shrink-0">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-amber-500 font-extrabold text-[15px] tracking-tighter">OMP</span>
          <span className="ml-[1px] text-ink">Chamber</span>
          <span className="absolute -top-0.5 -right-1.5 flex">
            <StreamStatusDot status={streamStatus} />
          </span>
        </span>

        <span className="text-ink/25 font-light text-xs flex-shrink-0 select-none">/</span>

        <div className="relative min-w-0" ref={sessionPickerRef}>
          <button
            type="button"
            onClick={() => setShowSessionPicker(!showSessionPicker)}
            className="flex items-center space-x-1 text-xs font-semibold text-ink hover:text-ink/80 transition-colors py-1 max-w-[150px] min-w-0"
            title={displayTitle}
          >
            <span className="truncate">{displayTitle}</span>
            {/* The phone's drawer row spins too, but the drawer is closed while
                the user reads the chat — and "Rename with AI" is reachable from
                the drawer alone, so without this the click would look like it
                did nothing at all until the name changed. */}
            {renaming && (
              <Loader2
                size={12}
                className="animate-spin text-ink/50 flex-shrink-0"
                role="status"
                aria-label="Generating a session name…"
              />
            )}
            <ChevronDown size={13} className="text-ink/50 flex-shrink-0" />
          </button>

          {/* Pinned to the viewport, not to the trigger: the trigger sits
              ~155px from the left edge, so a 288px panel anchored at its
              `left-0` ran off the right edge of a phone screen. Fixed with
              both insets keeps it inside the safe area at any width. */}
          {showSessionPicker && (
            <div
              className="fixed z-50 bg-paper border border-ink/15 rounded-xl shadow-lg p-2 text-xs"
              style={{
                top: 'calc(3.5rem + env(safe-area-inset-top, 0px) + 0.375rem)',
                left: 'max(0.75rem, env(safe-area-inset-left, 0px))',
                right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
                maxWidth: '18rem',
                // A landscape phone is only ~390px tall; without this the list
                // ran past the bottom edge the same way it ran past the right.
                maxHeight: 'calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px) - 1.125rem)',
                overflowY: 'auto',
              }}
            >
              <button
                type="button"
                onClick={() => { onNewSession(); setShowSessionPicker(false); }}
                className="w-full text-left px-3 py-2 rounded-lg bg-ink text-canvas flex items-center space-x-2 font-medium mb-1.5 active:scale-98"
              >
                <Plus size={14} />
                <span>Start New Session</span>
              </button>

              <div className="px-2 py-1 text-[10px] uppercase font-bold text-ink/40">Recent Sessions</div>
              <div className="max-h-64 scrollbar-overlay-container space-y-0.5">
                {recentSessions.length === 0 ? (
                  <div className="px-2.5 py-2 text-ink/40 italic">No sessions yet</div>
                ) : (
                  recentSessions.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { onSelectSession(s.id); setShowSessionPicker(false); }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between space-x-2 transition-colors ${
                        String(activeSessionId) === String(s.id)
                          ? 'bg-ink/10 font-semibold text-ink'
                          : 'hover:bg-ink/5 text-ink/80'
                      }`}
                    >
                      <span className="min-w-0 flex flex-col">
                        <span className="truncate">
                          {s.title ? s.title.charAt(0).toUpperCase() + s.title.slice(1) : 'Untitled'}
                        </span>
                        <span className="truncate text-[10px] text-ink/40 font-mono">{s.folderName}</span>
                      </span>
                      {String(activeSessionId) === String(s.id) && <Check size={12} className="flex-shrink-0" />}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: reload, context telemetry & right panel toggle */}
      <div className="flex items-center space-x-1 text-ink">
        <ReloadPageButton
          size={18}
          className="w-8 h-8 rounded-lg hover:bg-ink/5 active:bg-ink/10 flex items-center justify-center text-ink transition-colors cursor-pointer"
        />
        <ContextUsageButton
          sessionId={activeSessionId == null ? null : String(activeSessionId)}
          layout="mobile"
        />

        <button
          type="button"
          onClick={onOpenRightSidebar}
          className="w-8 h-8 rounded-lg hover:bg-ink/5 active:bg-ink/10 flex items-center justify-center text-ink transition-colors cursor-pointer"
          title="Right Panel"
          aria-label="Open Right Panel"
        >
          <PanelRight size={18} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}
