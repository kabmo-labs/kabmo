import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import { Group, Panel, type PanelImperativeHandle } from '@/client/components/layout/desktop-layout/resizer';
import { LeftColumn } from '@/client/components/layout/desktop-layout/LeftColumn';
import { DesktopOverlays } from '@/client/components/layout/desktop-layout/DesktopOverlays';
import { useFileTabs } from '@/client/hooks/workspace/file-tabs';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { TopNavbar } from '@/client/components/layout/desktop-layout/TopNavbar';
import { WorkspacePanels } from '@/client/components/layout/desktop-layout/WorkspacePanels';
import { WindowAura } from '@/client/components/layout/WindowAura';
import { ShellNotice } from '@/client/components/layout/ShellNotice';
import { usePanelSlotPlugins } from '@/client/components/workspace/plugin-panel/resolve';
import { useAgentStreamStatus } from '@/client/hooks/chat/omp/status';
import { usePanelWidths } from '@/client/hooks/workspace/panel-widths';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { resolveLeftDockMinWidth } from '@/shared/lib/workspace/left-dock-width';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';
import { DEFAULT_RIGHT_PANEL_TYPE } from '@/shared/lib/workspace/right-panels';
import { useOpenPanelRequest } from '@/client/hooks/workspace/open-panel';
import { useLeftDock, useLeftDockWidth } from '@/client/hooks/workspace/left-dock';
import { useEditorViewLayout } from '@/client/hooks/workspace/editor-view';
import { useLeftDockView } from '@/client/components/workspace/plugin-panel/catalog';
import type { EditorWidthMode } from '@/shared/lib/workspace/panel-widths';
import { useSettingsModal } from '@/client/hooks/ui/settings-modal';
import { useWorkspaceCommands } from '@/client/hooks/workspace/commands';
import { PluginBootstrap } from '@/client/lib/plugins/bootstrap';
import { useToasts } from '@/client/hooks/ui/toasts';
import type { EditorDropResult } from '@/client/hooks/editor/use-editor-drop';
import { useNavbarSessionActions } from '@/client/hooks/workspace/navbar-session-actions';
import { useCopyTabPath } from '@/client/hooks/workspace/copy-tab-path';
import { useRightSideLayout, type RightSideLayout } from '@/client/hooks/workspace/right-side';
import { useActiveWorkspaceProject } from '@/client/hooks/workspace/active-project';

interface DesktopLayoutProps {
  sessionId: string | null;
  onSwitchToMobile?: () => void;
  appSettings?: Record<string, any>;
}

export function DesktopLayout({ sessionId, onSwitchToMobile, appSettings = {} }: DesktopLayoutProps) {
  const { folders, isMock } = useSidebarData();
  // A new session opens Files. Deliberately NOT `appSettings.activeRightPanel`:
  // pre-per-session builds stored that key globally, so reading it back made
  // every new chat open whichever panel was last picked in any other session.
  const [activeRightPanel, setActiveRightPanel] = useSessionState<string>('layout.activeRightPanel', DEFAULT_RIGHT_PANEL_TYPE);
  const [showLeftPanel, setShowLeftPanel] = useSessionState<boolean>('layout.showLeftPanel', appSettings.showLeftPanel ?? true);
  const [activeLeftView, setActiveLeftView] = useSessionState<string>('layout.activeLeftPanel', SESSIONS_VIEW_ID);
  // Which plugin panel, if any, owns the editor column. Per session, like every
  // other layout choice: two chats may be working on different things.
  const [activeEditorPanelKey, setActiveEditorPanelKey] = useSessionState<string | null>('layout.activeEditorPanel', null);
  const { widths: panelWidths, commitWidths } = usePanelWidths();
  // The dock's width is per VIEW and global, like the right panel's order: it
  // lists the same views in every chat.
  const dock = useLeftDock();
  // What the dock actually shows: a stored id naming a panel that has moved to
  // the right column falls back to the session list, while one naming nothing at
  // all is left for the dock to explain.
  const leftView = useLeftDockView(activeLeftView, dock.enabled);
  const [sidebarWidth, commitSidebarWidth] = useLeftDockWidth(leftView);
  // A view placed on the dock declares its own floor — a plugin's 320, a
  // built-in's own (the terminal 320, the wiki 420); the session list keeps the
  // column's own. Resolved through the width module so the resizer, the stored
  // width and the initial size cannot disagree.
  const leftDockMinWidth = resolveLeftDockMinWidth(leftView);

  const editorPanelRef = useRef<PanelImperativeHandle | null>(null);
  const rightPanelRef = useRef<PanelImperativeHandle | null>(null);
  const leftPanelRef = useRef<PanelImperativeHandle | null>(null);

  // The workspace the session belongs to, its root, and whether one exists —
  // one hook, because a worktree session reading its folder's path is how the
  // panels ended up on the wrong checkout.
  const { path: activeProjectPath, hasActiveContext } = useActiveWorkspaceProject(folders, sessionId);

  // Opening a file must show the column (and the side it lives on). The hook
  // that owns that flag is built below, after the tab list exists — a tab is
  // one of the things that gives the column content — so the callback reaches
  // it through a ref rather than a second owner for the same flag.
  const rightSideRef = useRef<RightSideLayout | null>(null);
  const handleOpenTab = useCallback(() => {
    rightSideRef.current?.revealEditor();
  }, []);

  const {
    openedFiles,
    activeFileId,
    setActiveFileId,
    handleOpenFile,
    handleCloseFile,
    handleReopenClosed,
    reopenableCount,
    convertDiffToEditor,
  } = useFileTabs(activeProjectPath, sessionId || '', handleOpenTab);

  // The tab strip's Copy Path action. Extracted because the layout's own
  // state must stay readable: one action, one owner.
  const handleCopyTabPath = useCopyTabPath();

  // Three ways the column has content: a file, a chosen takeover, and a
  // takeover that merely exists. Only the first two OPEN it — installing a
  // plugin must not push a column onto the screen — but the third is what the
  // toggle has to open on to, since the rail lives inside the column.
  const editorTakeovers = usePanelSlotPlugins();
  const editorHasContent =
    openedFiles.length > 0 || activeEditorPanelKey !== null || editorTakeovers.length > 0;

  /**
   * The right side's visibility: the editor column, the right panel and the
   * activity rail beside them. ONE hook, because the navbar's toggle puts all
   * three away with one click and brings all three back with the next — a
   * second owner for the editor's flag is how a rail stays behind beside a
   * collapsed panel (see `useRightSideLayout`).
   */
  const rightSide = useRightSideLayout({
    editorHasContent,
    editorOpensByDefault: openedFiles.length > 0 || activeEditorPanelKey !== null,
    showRightPanelInitially: appSettings.showRightPanel ?? true,
    userToggledEditorInitially: appSettings.userToggledEditor ?? null,
  });
  rightSideRef.current = rightSide;
  const { showRightPanel, showEditor } = rightSide;
  // ONE flag for the whole side, read by the navbar's control AND by the rail:
  // a second "is anything visible" spelling would let the button read one state
  // while the rail draws another.
  const rightSideShown = !rightSide.hidden;

  // A diff wants room a source file does not, so the editor panel keeps a
  // separate remembered width per tab kind.
  const editorWidthMode: EditorWidthMode = useMemo(
    () => (openedFiles.find(f => String(f.id) === String(activeFileId))?.isDiff ? 'diff' : 'editor'),
    [openedFiles, activeFileId],
  );

  /**
   * The editor's WIDTH mode (`compact` / `full`), entered from either toolbar.
   *
   * It collapses columns around the editor and is resolved here, not in the
   * panels, because the sidebar is a sibling of the whole workspace group: a
   * full view that left it standing would not be the width it promises.
   *
   * The mode is derived from `showEditor`, so closing the column returns the
   * chat and the sidebar without writing anything — reopening it comes back to
   * the width the user chose.
   */
  const editorView = useEditorViewLayout(showEditor);
  const sidebarOpen = showLeftPanel && !editorView.sidebarHidden;

  // Width restoration is declarative: each panel's `defaultSize` comes from the
  // remembered width for its current slot and `Panel` adopts a change, so a
  // view switch needs no imperative push and no cached layout can go stale.

  const [refreshKey, setRefreshKey] = useState(0);
  const handleRefreshWorkspace = () => setRefreshKey(k => k + 1);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const streamStatus = useAgentStreamStatus();
  const settings = useSettingsModal();

  const { pushToast } = useToasts();

  /**
   * A refused drop names its reason ("outside every workspace", "not text") —
   * a silent no-op reads as a broken target. The TARGET is `WorkspacePanels`':
   * a layout-wide one would accept a drop over the sidebar and right panel too.
   */
  const handleDropResult = useCallback(
    (result: EditorDropResult) => pushToast(result.message, result.ok ? 'success' : 'error'),
    [pushToast],
  );
  const { menu: sessionActions, sessionDelete } = useNavbarSessionActions(folders, sessionId, pushToast);

  /**
   * Ask for the sidebar (or put it away).
   *
   * Full view hides the sidebar, so asking for it must leave that mode —
   * otherwise the toggle flips a stored flag the layout is ignoring and the
   * click does nothing. `compact` is the mode that keeps the wider editor.
   */
  const handleToggleLeftPanel = (show: boolean) => {
    if (show) editorView.revealSidebar();
    setShowLeftPanel(show);
  };

  // The workspace shortcuts, from the shared keymap so the toggles' tooltips
  // name the bound chord. `⌘S` is absent: the editor owns it, and binding it
  // twice would save the file twice.
  useWorkspaceCommands({
    showEditor,
    editorHasContent,
    // Through the handler, not the raw flag: in full view the sidebar is hidden
    // by the editor's WIDTH mode, so flipping `showLeftPanel` alone would change
    // a value the layout is ignoring and the chord would do nothing.
    toggleSidebar: () => handleToggleLeftPanel(!sidebarOpen),
    toggleEditor: rightSide.toggleEditor,
    // The side's own switch, so the other chord and the navbar's button cannot
    // disagree about what "the right side" means.
    toggleRightPanel: rightSide.toggleRightSide,
    openSettings: () => (settings.isOpen ? settings.close() : settings.open()),
  });

  // Clicking the ACTIVE view on an open panel collapses that panel; any other
  // click selects and opens. One handler for both columns' rails.
  const handleChangeRightPanel = (panel: string) => {
    const collapsing = activeRightPanel === panel && showRightPanel;
    if (collapsing) rightSide.closeRightPanel();
    else {
      rightSide.revealRightPanel();
      setActiveRightPanel(panel);
    }
  };

  // A panel asked to be shown from somewhere that is not its own rail — a
  // plugin's navbar readout (`app.headerPanel({ opensPanel })`). Where it lives
  // is the USER's placement, so the handler resolves the column from the dock
  // state and opens it; see `useOpenPanelRequest`.
  useOpenPanelRequest({
    dock,
    onLeft: (panelKey) => {
      setActiveLeftView(panelKey);
      setShowLeftPanel(true);
    },
    onEditor: (panelKey) => {
      setActiveEditorPanelKey(panelKey);
      rightSide.revealEditor();
    },
    onRight: (panelKey) => {
      setActiveRightPanel(panelKey);
      rightSide.revealRightPanel();
    },
  });

  return (
    <div
      data-testid="app-root"
      className="app-window relative flex flex-col h-screen w-screen overflow-hidden bg-canvas text-ink font-sans selection:bg-ink selection:text-canvas"
    >
      <WindowAura />
      <ShellNotice isMock={isMock} />

      {/* Main Workspace: the resizable LEFT dock (rail + view, see
          `LeftColumn`) plus the right stack. */}
      <div className="flex flex-1 overflow-hidden">
        <Group
          orientation="horizontal"
          id="kabmo-main"
          onLayoutChanged={() => {
            const left = leftPanelRef.current?.getSize()?.inPixels;
            if (left != null && left > 0) commitSidebarWidth(Math.round(left));
          }}
        >
          <LeftColumn
            panelRef={leftPanelRef}
            open={sidebarOpen}
            railEnabled={dock.enabled}
            view={leftView}
            onSelectView={(panel) => {
              // A rail click means "show this view" — never "toggle" it. A
              // toggle would hide the rail the user is aiming at, and the dock
              // has its own collapse control in the header.
              setActiveLeftView(panel);
              if (!sidebarOpen) handleToggleLeftPanel(true);
            }}
            onCollapse={() => handleToggleLeftPanel(false)}
            width={sidebarWidth}
            minWidth={leftDockMinWidth}
            hasActiveContext={hasActiveContext}
            activeProjectPath={activeProjectPath}
            sessionId={sessionId}
            appSettings={appSettings}
            streamStatus={streamStatus}
            refreshKey={refreshKey}
            onRefresh={handleRefreshWorkspace}
            onOpenFile={(file) => handleOpenFile(file as Parameters<typeof handleOpenFile>[0])}
          />

          {/* Right stack: top navbar + resizable workspace (the group's filler).
              The column IS the document's main content, so it carries the
              landmark: a screen reader could otherwise jump only between the
              sidebar's `aside` and the header's `nav`, with everything the app
              exists for unreachable by landmark. */}
          <Panel id="main-right-stack" filler minSize={0}>
            <main className="flex flex-col h-full">
              <PluginBootstrap workspacePath={activeProjectPath} />
              <TopNavbar
                sessionTitle={sessionTitle}
                sessionId={sessionId}
                showLeftPanel={sidebarOpen}
                showRightSide={rightSideShown}
                streamStatus={streamStatus}
                onSwitchToMobile={onSwitchToMobile}
                onToggleRightSide={rightSide.toggleRightSide}
                onToggleLeftPanel={() => handleToggleLeftPanel(!sidebarOpen)}
                sessionActions={sessionActions}
              />

              <WorkspacePanels
                appSettings={appSettings}
                showEditor={showEditor}
                chatHidden={editorView.chatHidden}
                editorPanelRef={editorPanelRef}
                showRightPanel={showRightPanel}
                showRightSide={rightSideShown}
                activeRightPanel={activeRightPanel}
                activeEditorPanelKey={activeEditorPanelKey}
                onSelectEditorPanel={(panelKey) => {
                  setActiveEditorPanelKey(panelKey);
                  // Choosing a takeover must OPEN the column, or the click would
                  // land on a panel that is still collapsed.
                  if (panelKey) rightSide.revealEditor();
                }}
                rightPanelRef={rightPanelRef}
                panelWidths={panelWidths}
                editorWidthMode={editorWidthMode}
                hasActiveContext={hasActiveContext}
                activeProjectPath={activeProjectPath}
                openedFiles={openedFiles}
                activeFileId={activeFileId}
                refreshKey={refreshKey}
                onSetActiveFileId={setActiveFileId}
                onCloseFile={handleCloseFile}
                onConvertDiffToEditor={convertDiffToEditor}
                onReopenClosed={handleReopenClosed}
                reopenableCount={reopenableCount}
                onCopyPath={handleCopyTabPath}
                onOpenFile={handleOpenFile}
                onRefreshWorkspace={handleRefreshWorkspace}
                onDropResult={handleDropResult}
                onChangeRightPanel={handleChangeRightPanel}
                onCloseRightPanel={rightSide.closeRightPanel}
                onHideEditor={rightSide.hideEditor}
                onSessionTitle={setSessionTitle}
                onPanelWidths={commitWidths}
              />
            </main>
          </Panel>
        </Group>
      </div>

      <DesktopOverlays settings={settings} sessionDelete={sessionDelete} appSettings={appSettings} />
    </div>
  );
}
