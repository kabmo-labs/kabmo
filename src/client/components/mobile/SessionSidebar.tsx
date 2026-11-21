import { useState } from 'preact/hooks';
import { MobileSessionHeader } from '@/client/components/mobile/mobile-session-sidebar/Header';
import { MobileSessionFooter } from '@/client/components/mobile/mobile-session-sidebar/Footer';
import { useMobileUpdateFlow } from '@/client/hooks/ui/updates/mobile-flow';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useCancelWait } from '@/client/hooks/chat/waiting/cancel';
import { useWaitingDispatch } from '@/client/hooks/chat/waiting/dispatch';
import { useSidebarStyle } from '@/client/hooks/workspace/sidebar-style';
import { openKeyBindingHelp } from '@/client/lib/commands/overlays';
import { useScheduledTaskCount } from '@/client/hooks/workspace/scheduled-tasks';
import { phoneLeftStripVisible } from '@/shared/lib/workspace/mobile-dock';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';
import { MobileDockStrip } from '@/client/components/mobile/mobile-session-sidebar/Dock';
import { DrawerBody } from '@/client/components/mobile/mobile-session-sidebar/Body';
import { PanelTabsColumn } from '@/client/components/workspace/panel-tabs';
import { useMobileDrawerTabs } from '@/client/components/mobile/mobile-session-sidebar/use-drawer-tabs';
import { drawerStripProps } from '@/client/components/mobile/drawer-strip';
import { MobileDrawerDialogs } from '@/client/components/mobile/mobile-session-sidebar/Dialogs';
import { useDrawerState } from '@/client/components/mobile/mobile-session-sidebar/use-drawer';
import { archiveOutcomeMessage } from '@/client/hooks/workspace/batch-archive';
import { VisibilityMenu } from '@/client/components/layout/VisibilityMenu';
import { usePanelVisibilityMenu } from '@/client/hooks/workspace/panel-visibility-menu';

/**
 * The phone's session drawer — the dispatcher, exactly like the desktop
 * `SessionsView`.
 *
 * It owns the controller, the folder expansion, the batch machine and the
 * dialogs; two chromes draw the list. `classic` is the drawer that shipped
 * before the style setting (`ClassicDrawer`), `modern` is the same
 * `ModernSidebarView` the desktop dock uses with `touch` density — NOT a second
 * phone implementation, so a row drawn here and a row drawn on a desktop are
 * the same component at two sizes.
 *
 * Two rules the drawer carries into both styles:
 *
 * - **The list is hidden, never unmounted, while a placed panel is on screen**
 *   (the same rule the desktop dock follows): its folder expansion, scroll
 *   position and batch selection must survive a look at another view, and a
 *   re-mount would re-seed every expansion from the server's flags.
 * - **New Session closes the drawer.** The pending chat is opened behind it, so
 *   the user lands on the chat rather than on the list they just acted on.
 */
interface MobileSessionSidebarProps {
  activeSessionId: number | string | null;
  onSelectSession: (id: number | string) => void;
  onNewSession: () => void;
  onNewSessionForFolder: (folderId: number) => void;
  /** Start a chat in a worktree made from this folder. */
  onNewWorktreeSession?: (folderId: number, worktreePath: string) => void;
  onClose: () => void;
  onDesktopToggle?: () => void;
  appSettings?: Record<string, any>;
  /** The active workspace's root, for a plugin panel placed on the dock. */
  rootPath?: string;
  /** Bumped after a write so a placed panel re-reads, like the right drawer. */
  refreshKey?: number;
  onRefresh?: () => void;
  onOpenFile?: (file: unknown) => void;
  /**
   * A header control asked for this drawer.
   *
   * The session screen stays MOUNTED while the chat is on screen (its status-ack
   * effect must run), so the drawer has no mount edge to read — this counter,
   * bumped only by the header's own control, is what says "a reveal gesture
   * landed". Without it the reopen drew the catalog (`Panel kiri`) over a chat
   * the user had just asked to see the panel beside.
   */
  revealSignal?: number;
}

export function MobileSessionSidebar({
  activeSessionId,
  onSelectSession,
  onNewSession,
  onNewSessionForFolder,
  onNewWorktreeSession,
  onClose,
  onDesktopToggle,
  appSettings = {},
  rootPath,
  refreshKey = 0,
  onRefresh,
  onOpenFile,
  revealSignal = 0,
}: MobileSessionSidebarProps) {
  const { controller, batch, expandedFolders, toggleFolder, optionsRef, dock, dockBody } = useDrawerState({
    appSettings,
    onSelectSession,
    onClose,
    rootPath,
    refreshKey,
    onRefresh,
    onOpenFile,
  });
  // Only what the CHROME needs: the list's own fields belong to `DrawerBody`,
  // which reads the controller itself. Re-destructuring them here is how the
  // two would drift about which of them the drawer owns.
  const { showArchived, setShowArchived } = controller;
  const { selection, deleteRun, archiveRun, selected, scopeFolder } = batch;
  const sidebarStyle = useSidebarStyle();

  // The phone's right-click: a long press on the drawer's title or its chip
  // strip opens the same panel switch the desktop left rail has. The strip IS
  // the rail here, so the menu lists exactly what the rail can draw — the
  // session list pinned, plus every placed panel, off or on.
  const panelMenu = usePanelVisibilityMenu('left');

  // Modals state (matching desktop)
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const scheduledCount = useScheduledTaskCount();
  const [aboutOpen, setAboutOpen] = useState(false);
  const { pushToast } = useToasts();
  const cancelWait = useCancelWait(pushToast);
  useWaitingDispatch({ onNotice: pushToast });
  const { updates, shellDownload } = useMobileUpdateFlow({
    onClose,
    openAbout: () => setAboutOpen(true),
    pushToast,
  });

  // The strip's state machine, including the reveal a header press asks for and
  // the flag that keeps a close from being read as a request.
  const { tabs: tabHandle } = useMobileDrawerTabs(dock, revealSignal);

  const handleNewSessionAndClose = () => {
    onNewSession();
    onClose();
  };

  // Archive the selection — the same reversible flow the desktop dispatcher
  // runs: no confirmation, one toast, leave the mode once the rows have moved
  // to the archive view. A request-level error keeps the selection to retry.
  const handleArchiveSelected = () => {
    void archiveRun.archive(selected).then((result) => {
      if (!result) return;
      const report = archiveOutcomeMessage(result);
      if (report) pushToast(report.message, report.tone);
      if (!result.error) selection.end();
    });
  };

  // Same dismissal as the toolbar's New Session: the pending session is opened
  // behind the drawer, so the user must land on the chat, not on the list.
  const handleNewSessionForFolderAndClose = (folderId: number) => {
    onNewSessionForFolder(folderId);
    onClose();
  };

  // The Archive control is a sibling of the sort dropdown, not a row inside it,
  // so this no longer has to dismiss the dropdown itself — clicking anywhere
  // outside the menu does that already, and doing it here as well would be a
  // second answer to the same question.
  const handleToggleArchived = () => {
    setShowArchived(!showArchived);
  };

  const closeAfterWorktree = onNewWorktreeSession
    ? (id: number, path: string) => {
        onNewWorktreeSession(id, path);
        onClose();
      }
    : undefined;

  // The same contract the desktop dispatcher hands its two styles, so the phone
  // and the desktop cannot describe a folder, a row or an action differently.
  /**
   * The view stack, built once and handed to whichever chrome is drawing.
   *
   * A COMPONENT rather than inline JSX (`mobile-session-sidebar/Body`): the same
   * node is the screen under `classic` and the body of `PanelTabsColumn` under
   * `tabs`, and the session list inside it must stay MOUNTED while another view
   * is on screen — its folder expansion, scroll position and batch selection
   * live in it.
   */
  const drawerBody = (
    <DrawerBody
      sidebarStyle={sidebarStyle}
      controller={controller}
      batch={batch}
      dock={dock}
      dockBody={dockBody}
      expandedFolders={expandedFolders}
      optionsRef={optionsRef}
      activeSessionId={activeSessionId}
      scheduledCount={scheduledCount}
      onToggleFolder={toggleFolder}
      onNewSession={handleNewSessionAndClose}
      onNewWorkspace={() => setNewWorkspaceOpen(true)}
      onScheduler={() => setSchedulerOpen(true)}
      onToggleArchived={handleToggleArchived}
      onNewSessionForFolder={handleNewSessionForFolderAndClose}
      {...(closeAfterWorktree ? { onNewWorktreeSession: closeAfterWorktree } : {})}
      onToast={pushToast}
      onArchiveSelected={handleArchiveSelected}
      onCancelWait={cancelWait}
    />
  );

  return (
    <div className="flex flex-col h-full w-full bg-canvas text-ink relative select-none">

      {/* The title bar is drawn in BOTH chromes, because the LEFT column's is
          not the strip: it carries the wordmark, the server chip and the close
          control, and the desktop column draws exactly the same pair — a title
          row across the column, then the strip under it (`LeftColumn`:
          40 + 38 + 40). Removing it under `tabs` left the drawer with no way
          back to the chat except the Android back gesture, and no wordmark at
          all; the RIGHT drawer is the one that has no header, because there the
          strip is the whole chrome. */}
      <MobileSessionHeader
        onClose={onClose}
        viewLabel={dock.showingSessions ? 'Sessions' : dock.activePanel?.label ?? 'Panel'}
        menuProps={panelMenu.surfaceProps}
      />

      {/* Under `tabs` the strip is the drawer's whole chrome (`PanelTabsColumn`
          below), so the classic chip row is not drawn on top of it. Under
          `classic` the strip is the phone's RAIL and follows the switch: with the
          rail on it always draws, exactly like the desktop column's rail (which
          always holds Sessions). Requiring a second destination made the Settings
          switch a no-op on a phone with nothing placed. */}
      {!dock.tabsMode && phoneLeftStripVisible(dock.enabled) ? (
        <MobileDockStrip
          panels={dock.catalog}
          activeId={dock.activeView}
          onSelect={dock.setActiveView}
          menuProps={panelMenu.surfaceProps}
        />
      ) : null}

      {/* The desktop column's shape, on a phone: the strip and its home page are
          the drawer's chrome, and the view stack is the body under them. The
          session list is the PINNED first chip (`usePanelTabs` is given
          `SESSIONS_VIEW_ID`), so closing every other tab lands back on the
          catalog with Sessions still one tap away — the same dead-end rule the
          desktop column follows. */}
      {/* No trailing action. A refresh here is either redundant or dead:
          the four views that read `refreshKey` (Files, GIT, Context, WIKI) each
          draw their own refresh control in their own toolbar — where it sits
          beside the repo picker it re-reads — and the other five (Search,
          Terminal, Usage, Todos, Plan) ignore `refreshKey` entirely, so the
          button would do nothing at all. The session list has its own too
          (`MobileSessionToolbar`'s "Refresh sessions"). Measured on the running
          drawer with Files open: one click issued zero requests.
          The desktop column keeps its strip refresh because the desktop's
          session list does NOT draw one; the phone's does. */}
      {dock.tabsMode && tabHandle ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <PanelTabsColumn
          catalog={dock.catalog}
          tabs={tabHandle}
          pinned={SESSIONS_VIEW_ID}
          homeTitle="Panel kiri"
          // The strip is this drawer's title bar, so it carries the WINDOW
          // contract the header used to: the drag region the shells hit-test,
          // the notch as height AND padding, and the shell's traffic-light
          // inset. The right drawer states the same thing through the same
          // helper; without it here a narrowed shell window lost its drag
          // handle and a phone put the chips under the status bar.
          stripProps={drawerStripProps(panelMenu.surfaceProps)}
        >
            <div className="h-full w-full">{drawerBody}</div>
          </PanelTabsColumn>
        </div>
      ) : null}

      {panelMenu.anchor ? (
        <VisibilityMenu
          anchor={panelMenu.anchor}
          items={panelMenu.items}
          hidden={panelMenu.hidden}
          onToggle={panelMenu.toggle}
          onClose={panelMenu.close}
        />
      ) : null}

      {/* The `classic` chrome: the chip row above is the rail, so the stack is
          the whole remaining screen. */}
      {dock.tabsMode ? null : <div className="contents">{drawerBody}</div>}

      <MobileSessionFooter
        onSettings={() => window.dispatchEvent(new CustomEvent('omp:open-settings', { detail: {} }))}
        onKeyBindings={openKeyBindingHelp}
        onAbout={() => setAboutOpen(true)}
        shellDownload={shellDownload}
        onDesktopToggle={onDesktopToggle}
        updateAvailable={updates.hasUpdate}
        onUpdateClick={() => {
          setAboutOpen(true);
          void updates.check();
        }}
      />

      <MobileDrawerDialogs
        activeSessionId={activeSessionId}
        newWorkspaceOpen={newWorkspaceOpen}
        onCloseNewWorkspace={() => setNewWorkspaceOpen(false)}
        schedulerOpen={schedulerOpen}
        onCloseScheduler={() => setSchedulerOpen(false)}
        aboutOpen={aboutOpen}
        onCloseAbout={() => setAboutOpen(false)}
        updates={updates}
        pushToast={pushToast}
        batchDelete={deleteRun}
        batchMode={selection.mode}
        onEndBatch={selection.end}
        scopeLabel={scopeFolder?.name}
      />

    </div>
  );
}
