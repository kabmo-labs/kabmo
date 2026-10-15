import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, Loader2, Menu, PanelRight, Plus } from 'lucide-preact';
import type { SessionContextTelemetry } from '@/shared/types/context';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { getLastOpenedAt } from '@/shared/lib/workspace/session-state/store';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { useAgentStreamStatus } from '@/client/hooks/chat/omp/status';
import { useSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import { StreamStatusDot } from '@/client/components/common/StreamStatusDot';
import { formatCompactTokens } from '@/shared/lib/format/number';
import { useModelNames } from '@/client/hooks/models/use-model-names';
import { useProviderNames } from '@/client/hooks/models/use-provider-names';
import { providerLabel } from '@/shared/lib/models/provider/label';

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
  const modelNames = useModelNames();
  const providerNames = useProviderNames();
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [telemetry, setTelemetry] = useState<SessionContextTelemetry | null>(null);

  const sessionPickerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(sessionPickerRef, () => setShowSessionPicker(false));

  const telemetryRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(telemetryRef, () => setShowTelemetry(false));

  // Real context telemetry for the active session (the same source the Context
  // panel reads). No session → nothing to report, so the readout stays empty
  // instead of showing invented runtime numbers.
  useEffect(() => {
    if (!activeSessionId) {
      setTelemetry(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/telemetry/context?sessionId=${encodeURIComponent(String(activeSessionId))}`)
      .then(res => (res.ok ? res.json() : null))
      .then((data: { telemetry?: SessionContextTelemetry } | null) => {
        if (!cancelled) setTelemetry(data?.telemetry ?? null);
      })
      .catch(() => {
        if (!cancelled) setTelemetry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

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

  // The telemetry reports the model as `provider/modelId` (omp's own selector).
  // Split once here so the popover can print the provider and the model on
  // separate lines and resolve each to its display name — the raw slug reads as
  // "kenari-jatis/deepseek-v4-1-flash", which names neither the vendor nor the
  // model as the user picked them.
  const { providerName, modelName } = useMemo(() => {
    const selector = telemetry?.modelId ?? '';
    const slash = selector.indexOf('/');
    if (slash <= 0) return { providerName: selector, modelName: '' };
    const providerSlug = selector.slice(0, slash);
    const modelId = selector.slice(slash + 1);
    return {
      providerName: providerLabel(providerSlug, providerNames),
      modelName: modelNames[modelId] ?? modelId,
    };
  }, [telemetry?.modelId, providerNames, modelNames]);

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

      {/* Right: context telemetry & right panel toggle */}
      <div className="flex items-center space-x-1 text-ink">
        <div className="relative flex items-center" ref={telemetryRef}>
          <button
            type="button"
            onClick={() => setShowTelemetry(!showTelemetry)}
            className="w-8 h-8 rounded-lg hover:bg-ink/5 active:bg-ink/10 flex items-center justify-center text-ink transition-colors cursor-pointer"
            title="Context usage"
            aria-label="Context usage"
          >
            <span className="w-4 h-4 rounded-full border-[1.5px] border-ink/60 hover:border-ink transition-colors" />
          </button>
          {showTelemetry && (
            <div className="absolute top-full right-0 mt-2 w-56 bg-paper border border-ink/20 rounded-xl shadow-xl z-50 p-3 text-xs font-mono">
              <div className="font-semibold text-ink font-sans pb-1.5 border-b border-ink/10 flex items-center justify-between">
                <span>Context</span>
                {telemetry && telemetry.messagesCount > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-success" />
                )}
              </div>
              {!telemetry || telemetry.messagesCount === 0 ? (
                <div className="pt-2 text-[11px] text-ink/50 italic font-sans">Session not started</div>
              ) : (
                <div className="pt-2 space-y-1.5 text-[11px] text-ink/80">
                  <div className="flex justify-between gap-2">
                    <span className="text-ink/50 flex-shrink-0">Provider:</span>
                    <span className="truncate text-right">{providerName || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-ink/50 flex-shrink-0">Model:</span>
                    <span className="truncate text-right">{modelName || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/50">Context:</span>
                    <span>
                      {formatCompactTokens(telemetry.contextUsed) ?? '0'} / {formatCompactTokens(telemetry.contextLimit) ?? '0'} ({telemetry.contextPercent}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/50">Messages:</span>
                    <span>{telemetry.messagesCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink/50">Cost:</span>
                    <span>{telemetry.costFormatted}</span>
                  </div>
                  {typeof telemetry.cacheHitAverage === 'number' && (
                    <div className="flex justify-between">
                      <span className="text-ink/50">Cache hit:</span>
                      <span>{telemetry.cacheHitAverage.toFixed(1)}%</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

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
