import { Loader2, MoreHorizontal, PanelLeft } from 'lucide-preact';
import { HeaderControls } from '@/client/components/common/header-controls';
import { BrandWordmark } from '@/client/components/common/brand-wordmark';
import { StreamStatusDot } from '@/client/components/common/StreamStatusDot';
import { SessionActionsMenu, useRowMenu } from '@/client/components/common/session-actions-menu';
import { useInlineRename } from '@/client/hooks/ui/inline-rename';
import { useSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import type { AgentStreamStatus } from '@/shared/lib/chat/omp/status';
import { withChord } from '@/client/lib/ui/with-chord';
import { titlebarPaddingLeft, titlebarPaddingRight } from '@/shared/lib/ui/titlebar';

interface TopNavbarProps {
  sessionTitle: string | null;
  /** The session the title belongs to, for the in-flight rename cue. */
  sessionId?: string | null;
  showLeftPanel: boolean;
  showEditor: boolean;
  showRightPanel: boolean;
  /** Live agent event stream status; the indicator is WebSocket-only. */
  streamStatus?: AgentStreamStatus;
  onSwitchToMobile?: () => void;
  onToggleEditor: () => void;
  onToggleRightPanel: () => void;
  onToggleLeftPanel: () => void;
  /** Session-level actions for the title's overflow menu, when a session is on screen. */
  sessionActions?: {
    isArchived?: boolean;
    /** Omitted for a session that cannot be renamed yet (a pending `new-…` chat). */
    onRename?: (name: string) => void;
    /** Ask omp to name the session from its transcript. */
    onRenameWithAi?: () => void;
    onArchive?: () => void;
    onDelete?: () => void;
  };
}

export function TopNavbar({
  sessionTitle,
  sessionId,
  showLeftPanel,
  showEditor,
  showRightPanel,
  streamStatus,
  onSwitchToMobile,
  onToggleEditor,
  onToggleRightPanel,
  onToggleLeftPanel,
  sessionActions,
}: TopNavbarProps) {
  // The title is renamed in place here, the way a sidebar row is: the overflow
  // menu offers Rename and the header swaps its label for the field.
  const rename = useInlineRename(sessionTitle ?? '', sessionActions?.onRename);
  const menu = useRowMenu();
  // The title menu's "Rename with AI" acts on the session on screen, whose
  // sidebar row may be scrolled out of view — so the header says the wait is
  // happening even when the row that started it is not on screen.
  const renaming = useSessionRenaming(sessionId);
  const hasSessionActions = Boolean(
    sessionActions && (sessionActions.onRename || sessionActions.onRenameWithAi || sessionActions.onArchive || sessionActions.onDelete)
  );
  return (
    <header 
      className="h-10 flex-shrink-0 border-b border-ink/10 bg-paper flex items-center justify-between z-20 titlebar-drag-region select-none"
      style={{
        // The sidebar's own header carries the left inset while it is open.
        paddingLeft: !showLeftPanel ? titlebarPaddingLeft('1rem') : undefined,
        paddingRight: titlebarPaddingRight('1rem'),
      }}
    >
      <div className="flex items-center space-x-2 px-4 min-w-0">
        {!showLeftPanel && (
          <>
            <button
              type="button"
              onClick={onToggleLeftPanel}
              className="p-1.5 rounded hover:bg-ink/10 transition-colors text-ink/60 hover:text-ink cursor-pointer flex-shrink-0 titlebar-no-drag"
              title={withChord('toggleSidebar', 'Expand Sidebar')}
              aria-label={withChord('toggleSidebar', 'Expand Sidebar')}
            >
              <PanelLeft size={16} />
            </button>
            <span className="relative font-bold text-sm tracking-tight hidden sm:flex items-center flex-shrink-0">
              <BrandWordmark />
              {/* Same badge placement the sidebar header and the phone use:
                  the stream indicator belongs to the wordmark, not to the
                  control cluster. */}
              <span className="absolute -top-0.5 -right-1.5 flex">
                <StreamStatusDot status={streamStatus} />
              </span>
            </span>
            {sessionTitle && (
              <span className="text-ink/30 text-xs select-none flex-shrink-0">/</span>
            )}
          </>
        )}
        {sessionTitle && (
          <div className="flex items-center space-x-2 titlebar-no-drag">
            {rename.isEditing ? (
              <input
                ref={rename.inputRef}
                autoFocus
                value={rename.draft}
                onInput={(e) => rename.setDraft(e.currentTarget.value)}
                onKeyDown={rename.handleKeyDown}
                onBlur={rename.handleBlur}
                className="w-48 min-w-0 bg-paper border border-ink/25 rounded px-1.5 py-0.5 text-xs text-ink font-semibold outline-none focus:border-ink/50"
                title="Session title"
                aria-label="Session title"
              />
            ) : (
              <span className="font-bold text-sm tracking-tight hidden sm:flex items-center gap-1.5">
                <span className="font-semibold text-xs text-ink truncate">
                  {sessionTitle.charAt(0).toUpperCase() + sessionTitle.slice(1)}
                </span>
                {renaming && (
                  <Loader2
                    size={12}
                    className="animate-spin text-ink/50 shrink-0"
                    role="status"
                    aria-label="Generating a session name…"
                  />
                )}
              </span>
            )}
            {hasSessionActions && !rename.isEditing && (
              <button
                type="button"
                onClick={menu.openBelow}
                title="Session actions"
                aria-label="Session actions"
                aria-haspopup="menu"
                aria-expanded={menu.anchor !== null}
                className="p-1 rounded text-ink/40 hover:text-ink hover:bg-ink/10 cursor-pointer flex-shrink-0"
              >
                <MoreHorizontal size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3 titlebar-no-drag">
        {/* One cluster, one order, shared with the phone's header. Each layout
            passes only what it has; the order is stated in `HeaderControls`. */}
        <HeaderControls
          layout="desktop"
          sessionId={sessionId ?? null}
          showRightPanel={showRightPanel}
          onToggleRightPanel={onToggleRightPanel}
          showEditor={showEditor}
          onToggleEditor={onToggleEditor}
          onSwitchToMobile={onSwitchToMobile}
        />
      </div>

      {menu.anchor && sessionActions && (
        <SessionActionsMenu
          anchor={menu.anchor}
          isArchived={sessionActions.isArchived}
          onRename={sessionActions.onRename ? rename.startRename : undefined}
          onRenameWithAi={sessionActions.onRenameWithAi}
          onArchive={sessionActions.onArchive}
          onDelete={sessionActions.onDelete}
          onClose={menu.close}
        />
      )}
    </header>
  );
}
