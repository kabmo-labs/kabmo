import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { Group, Panel, type PanelImperativeHandle } from '@/client/components/layout/desktop-layout/resizer';
import { LeftColumn } from '@/client/components/layout/desktop-layout/LeftColumn';
import { SettingsModal } from '@/client/components/settings/LazyModal';
import { activeProjectForSession, effectiveRootFor } from '@/shared/lib/workspace/active-project';
import { useFileTabs } from '@/client/hooks/workspace/file-tabs';
import type { OpenedFile } from '@/shared/types/fs';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { TopNavbar } from '@/client/components/layout/desktop-layout/TopNavbar';
import { WorkspacePanels } from '@/client/components/layout/desktop-layout/WorkspacePanels';
import { usePanelSlotPlugins } from '@/client/components/workspace/plugin-panel/resolve';
import { useAgentStreamStatus } from '@/client/hooks/chat/omp/status';
import { usePanelWidths } from '@/client/hooks/workspace/panel-widths';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { MIN_LEFT_PANEL_WIDTH } from '@/shared/lib/workspace/sidebar-width';
import { MIN_LEFT_DOCK_PLUGIN_WIDTH } from '@/shared/lib/workspace/left-dock-width';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';
import { useOpenPanelRequest } from '@/client/hooks/workspace/open-panel';
import { useLeftDock, useLeftDockWidth } from '@/client/hooks/workspace/left-dock';
import { useEditorViewLayout } from '@/client/hooks/workspace/editor-view';
import { useLeftDockView } from '@/client/components/workspace/plugin-panel/catalog';
import type { EditorWidthMode } from '@/shared/lib/workspace/panel-widths';
import { useSettingsModal } from '@/client/hooks/ui/settings-modal';
import { useWorkspaceKeybindings } from '@/client/hooks/workspace/keybindings';
import { PluginBootstrap } from '@/client/lib/plugins/bootstrap';
import { useToasts } from '@/client/hooks/ui/toasts';
import type { EditorDropResult } from '@/client/hooks/editor/use-editor-drop';
import { ToastStack } from '@/client/components/common/ToastStack';
import { SessionDeleteModal } from '@/client/components/common/session-delete-modal';
import { useNavbarSessionActions } from '@/client/hooks/workspace/navbar-session-actions';

interface DesktopLayoutProps {
  sessionId: string | null;
  onSwitchToMobile?: () => void;
  appSettings?: Record<string, any>;
}

export function DesktopLayout({ sessionId, onSwitchToMobile, appSettings = {} }: DesktopLayoutProps) {
  const { folders } = useSidebarData();
  const [showRightPanel, setShowRightPanel] = useSessionState<boolean>('layout.showRightPanel', appSettings.showRightPanel ?? true);
  const [activeRightPanel, setActiveRightPanel] = useSessionState<string>('layout.activeRightPanel', (appSettings.activeRightPanel as string) ?? 'files');
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
  // A plugin view placed on the dock declares its own floor; the session list
  // keeps the column's own. Resolved here because the resizer clamps to it.
  const leftDockMinWidth = leftView === SESSIONS_VIEW_ID ? MIN_LEFT_PANEL_WIDTH : MIN_LEFT_DOCK_PLUGIN_WIDTH;

  const editorPanelRef = useRef<PanelImperativeHandle | null>(null);
  const rightPanelRef = useRef<PanelImperativeHandle | null>(null);
  const leftPanelRef = useRef<PanelImperativeHandle | null>(null);
  const [userToggledEditor, setUserToggledEditor] = useSessionState<boolean | null>('layout.userToggledEditor', appSettings.userToggledEditor ?? null);

  const [searchParams] = useSearchParams();
  const folderIdParam = searchParams.get('folderId');
  const activeProject = useMemo(() => {
    const sessionFolder = activeProjectForSession(folders, sessionId || '').folder;
    if (sessionFolder) return sessionFolder;
    if (folderIdParam) return folders.find(f => String(f.id) === String(folderIdParam)) ?? null;
    return null;
  }, [folders, sessionId, folderIdParam]);
  // A worktree session runs OUTSIDE its folder's project path, so the panels
  // follow the session's own root — the checkout it left would otherwise be what
  // Files, Search, Git and the terminal read.
  const activeProjectPath = useMemo(
    () => effectiveRootFor(folders, sessionId || '') ?? activeProject?.project_path ?? null,
    [folders, sessionId, activeProject],
  );
  const hasActiveContext = !!activeProject;

  const handleOpenTab = useCallback(() => {
    setUserToggledEditor(true);
  }, [setUserToggledEditor]);

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

  /**
   * The tab menu's two scope-dependent actions.
   *
   * Copy Path needs the tab's own path (which may be a diff's), and Reveal needs the
   * Files panel to expand to it — both live here because the strip has no workspace
   * scope of its own.
   */
  const handleCopyTabPath = useCallback((tab: OpenedFile) => {
    if (!tab.path) return;
    void navigator.clipboard?.writeText(tab.path);
  }, []);

  // Three ways the column has content: a file, a chosen takeover, and a
  // takeover that merely exists. Only the first two OPEN it — installing a
  // plugin must not push a column onto the screen — but the third is what the
  // toggle has to open on to, since the rail lives inside the column.
  const editorTakeovers = usePanelSlotPlugins();
  // The user's own switch wins over every default, in both directions.
  const editorHasContent =
    openedFiles.length > 0 || activeEditorPanelKey !== null || editorTakeovers.length > 0;
  const showEditor =
    editorHasContent &&
    (userToggledEditor ?? (openedFiles.length > 0 || activeEditorPanelKey !== null));

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

  const { toasts, pushToast, dismissToast } = useToasts();

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
  useWorkspaceKeybindings({
    showEditor,
    editorHasContent,
    // Through the handler, not the raw flag: in full view the sidebar is hidden
    // by the editor's WIDTH mode, so flipping `showLeftPanel` alone would change
    // a value the layout is ignoring and the chord would do nothing.
    toggleSidebar: () => handleToggleLeftPanel(!sidebarOpen),
    toggleEditor: () => setUserToggledEditor((previous) => !(previous ?? showEditor)),
    toggleRightPanel: () => setShowRightPanel((previous) => !previous),
    openSettings: () => (settings.isOpen ? settings.close() : settings.open()),
  });

  // Clicking the ACTIVE view on an open panel collapses that panel; any other
  // click selects and opens. One handler for both columns' rails.
  const handleChangeRightPanel = (panel: string) => {
    const collapsing = activeRightPanel === panel && showRightPanel;
    setShowRightPanel(!collapsing);
    if (!collapsing) setActiveRightPanel(panel);
  };

  const handleToggleRightPanel = () => setShowRightPanel(!showRightPanel);
  const handleToggleEditor = () => setUserToggledEditor(!showEditor);

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
      setUserToggledEditor(true);
    },
    onRight: (panelKey) => {
      setActiveRightPanel(panelKey);
      setShowRightPanel(true);
    },
  });

  return (
    <div
      data-testid="app-root"
      className="relative flex flex-col h-screen w-screen overflow-hidden bg-canvas text-ink font-sans selection:bg-ink selection:text-canvas"
    >

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
            appSettings={appSettings}
            streamStatus={streamStatus}
            refreshKey={refreshKey}
            onRefresh={handleRefreshWorkspace}
            onOpenFile={(file) => handleOpenFile(file as Parameters<typeof handleOpenFile>[0])}
          />

          {/* Right stack: top navbar + resizable workspace (the group's filler) */}
          <Panel id="main-right-stack" filler minSize={0}>
            <div className="flex flex-col h-full">
              <PluginBootstrap workspacePath={activeProjectPath} />
              <TopNavbar
                sessionTitle={sessionTitle}
                sessionId={sessionId}
                showLeftPanel={sidebarOpen}
                showEditor={showEditor}
                showRightPanel={showRightPanel}
                streamStatus={streamStatus}
                onSwitchToMobile={onSwitchToMobile}
                onToggleEditor={handleToggleEditor}
                onToggleRightPanel={handleToggleRightPanel}
                onToggleLeftPanel={() => handleToggleLeftPanel(!sidebarOpen)}
                sessionActions={sessionActions}
              />

              <WorkspacePanels
                appSettings={appSettings}
                showEditor={showEditor}
                chatHidden={editorView.chatHidden}
                editorPanelRef={editorPanelRef}
                showRightPanel={showRightPanel}
                activeRightPanel={activeRightPanel}
                activeEditorPanelKey={activeEditorPanelKey}
                onSelectEditorPanel={(panelKey) => {
                  setActiveEditorPanelKey(panelKey);
                  // Choosing a takeover must OPEN the column, or the click would
                  // land on a panel that is still collapsed.
                  if (panelKey) setUserToggledEditor(true);
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
                onToggleRightPanel={handleToggleRightPanel}
                onSessionTitle={setSessionTitle}
                onPanelWidths={commitWidths}
              />
            </div>
          </Panel>
        </Group>
      </div>

      {/* Global Desktop Settings Modal */}
      <SettingsModal
        isOpen={settings.isOpen}
        onClose={settings.close}
        initialCategory={settings.category}
        autoOpenAddProvider={settings.autoOpenAddProvider}
        appSettings={appSettings}
      />

      {/* The navbar title menu's delete path and the rename-with-AI refusal
          surface here: this layout owns no sidebar, so it must render its own
          confirmation and toast stack. */}
      <SessionDeleteModal
        session={sessionDelete.pending}
        isDeleting={sessionDelete.isDeleting}
        error={sessionDelete.error}
        onClose={sessionDelete.cancelDelete}
        onConfirm={() => void sessionDelete.confirmDelete()}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
