import { Loader2, MoreHorizontal, PanelLeft } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import type { TargetedMouseEvent } from 'preact';
import { HeaderControls } from '@/client/components/common/header-controls';
import { BrandWordmark } from '@/client/components/common/brand-wordmark';
import { StreamStatusDot } from '@/client/components/common/StreamStatusDot';
import { SessionActionsMenu, useRowMenu } from '@/client/components/common/session-actions-menu';
import { VisibilityMenu, type MenuAnchor } from '@/client/components/layout/VisibilityMenu';
import { useHeaderEntries } from '@/client/components/common/header-panel-buttons/entries';
import { navbarControlItems, useNavbarControls } from '@/client/hooks/ui/navbar-controls';
import { useInlineRename } from '@/client/hooks/ui/inline-rename';
import { useSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import type { AgentStreamStatus } from '@/shared/lib/chat/omp/status';
import { withChord } from '@/client/lib/ui/with-chord';
import { CONTROL_BOX, CONTROL_BOX_PX, CONTROL_CLUSTER_GAP, ACTIVITY_BAR_WIDTH_PX, navbarEdgeInsets } from '@/client/lib/ui/control-plate';
import { titlebarPaddingLeft, titlebarPaddingRight } from '@/shared/lib/ui/titlebar';
import { ServerControl } from '@/client/components/common/server-control';
import { dragRegionProps, drawsWindowControls, titlebarInsetLeft } from '@/client/lib/desktop/titlebar';

interface TopNavbarProps {
  sessionTitle: string | null;
  /** The session the title belongs to, for the in-flight rename cue. */
  sessionId?: string | null;
  showLeftPanel: boolean;
  /**
   * The right side — editor column, right panel and their rail — is on screen.
   * ONE control switches all three; the editor column's own switch lives on the
   * panel's corner, not here.
   */
  showRightSide: boolean;
  /** Live agent event stream status; the indicator is WebSocket-only. */
  streamStatus?: AgentStreamStatus;
  onToggleRightSide: () => void;
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
  showRightSide,
  streamStatus,
  onToggleRightSide,
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
  // The rightmost control is the caption cluster in a Windows/Linux shell
  // window and the right-panel toggle everywhere else. The activity rail below
  // the navbar shares this right edge, so the inset is derived from whichever
  // control actually ends the row — a flat `1rem` left the toggle's centre 8px
  // off the rail's axis.
  const lastControlPx = drawsWindowControls() ? ACTIVITY_BAR_WIDTH_PX : CONTROL_BOX_PX.desktop;
  const insets = navbarEdgeInsets(showLeftPanel, lastControlPx);
  // The navbar's own right-click menu: the same switch the activity rails
  // have, for the row of controls above them. A hidden control stays a row of
  // this menu, so it is never lost.
  const { hidden, setHidden } = useNavbarControls();
  // Resolved here ONCE: the row and the menu are two halves of one answer, so
  // a plugin that adds a control adds its menu row in the same render.
  const headerEntries = useHeaderEntries('desktop');
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const openMenu = (event: TargetedMouseEvent<HTMLElement>) => {
    // A right-click inside the rename field is the browser's own menu (copy,
    // paste); taking it over would remove the only way to paste a title.
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    const rect = headerRef.current?.getBoundingClientRect();
    setMenuAnchor({
      top: rect?.top ?? 0,
      bottom: rect?.bottom ?? 0,
      left: rect?.left ?? event.clientX,
      right: rect?.right ?? event.clientX,
    });
  };
  return (
    <header
      ref={headerRef}
      onContextMenu={openMenu}
      className="glass-chrome h-10 flex-shrink-0 border-b border-ink/10 bg-paper flex items-center justify-between z-20 titlebar-drag-region select-none"
      {...dragRegionProps()}
      style={{
        // The sidebar's own header carries the left inset while it is open;
        // when it is closed the navbar is the window's left edge and carries it
        // itself. The expand button then sits on the left rail's axis, so it
        // does not jump when the dock opens. The group below carries no padding
        // of its own — the two used to add up, putting the button 24px off.
        paddingLeft: showLeftPanel ? insets.left : titlebarInsetLeft(titlebarPaddingLeft(insets.left)),
        paddingRight: titlebarPaddingRight(insets.right),
      }}
    >
      <div className="flex items-center space-x-2 min-w-0">
        {!showLeftPanel && (
          <>
            <button
              type="button"
              onClick={onToggleLeftPanel}
              className={`${CONTROL_BOX.desktop} hover:bg-ink/10 transition-colors text-ink/60 hover:text-ink cursor-pointer flex-shrink-0 titlebar-no-drag`}
              title={withChord('toggleSidebar', 'Expand Sidebar')}
              aria-label={withChord('toggleSidebar', 'Expand Sidebar')}
            >
              <PanelLeft size={16} />
            </button>
            <span className="relative font-bold text-sm tracking-tight hidden sm:flex items-center flex-shrink-0">
              <BrandWordmark glow />
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

      <div className={`flex items-center ${CONTROL_CLUSTER_GAP} titlebar-no-drag`}>
        {/* One cluster, one order, shared with the phone's header. Each layout
            passes only what it has; the order is stated in `HeaderControls`. */}
        {/* The shell's server control. It draws nothing in a browser; a shell
            window narrowed below the layout breakpoint renders the PHONE layout
            and gets the same control in the drawer's header instead — which is
            why the trigger, the store and the panel all live in one component
            rather than in this file. */}
        <ServerControl variant="nav" />
        <HeaderControls
          layout="desktop"
          sessionId={sessionId ?? null}
          showRightPanel={showRightSide}
          onToggleRightPanel={onToggleRightSide}
          entries={headerEntries}
          hidden={hidden}
        />
        {/* The Windows/Linux caption buttons come from `HeaderControls` itself:
            a desktop shell window can be narrower than the mobile breakpoint,
            so the phone header has to draw them too — and a control that only
            one layout renders is a control the other layout's window loses. */}
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

      {menuAnchor ? (
        <VisibilityMenu
          anchor={menuAnchor}
          title="Navbar"
          align="right"
          // A control this build does not draw has no row: the menu is the
          // switch for the row, and a checkbox for a control the navbar no
          // longer holds would hide nothing. Plugin entries are the row's too,
          // so they are listed even while switched off — hiding one never
          // loses it.
          items={navbarControlItems(headerEntries.inline).map((item) => ({ ...item, removable: true }))}
          hidden={hidden}
          onToggle={setHidden}
          onClose={() => setMenuAnchor(null)}
        />
      ) : null}
    </header>
  );
}
