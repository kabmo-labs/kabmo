import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { Group, Panel, type PanelImperativeHandle } from '@/client/components/layout/desktop-layout/resizer';
import { LeftColumn } from '@/client/components/layout/desktop-layout/LeftColumn';
import { SettingsModal } from '@/client/components/settings/LazyModal';
import type { SettingsCategoryId } from '@/shared/types';
import { activeProjectForSession } from '@/shared/lib/workspace/active-project';
import { useFileTabs } from '@/client/hooks/workspace/file-tabs';
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
import { useLeftDock, useLeftDockWidth } from '@/client/hooks/workspace/left-dock';
import { useLeftDockView } from '@/client/components/workspace/plugin-panel/catalog';
import type { EditorWidthMode } from '@/shared/lib/workspace/panel-widths';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { useWorkspaceKeybindings } from '@/client/hooks/workspace/keybindings';
import { PluginBootstrap } from '@/client/lib/plugins/bootstrap';
import { useToasts } from '@/client/hooks/ui/toasts';
import type { EditorDropResult } from '@/client/hooks/editor/use-editor-drop';
import { ToastStack } from '@/client/components/common/ToastStack';
import { SessionDeleteModal } from '@/client/components/common/session-delete-modal';
import { useSessionActions } from '@/client/hooks/workspace/session-actions';
import { useSessionDelete } from '@/client/hooks/workspace/session-delete';

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
  const activeProjectPath = activeProject?.project_path ?? null;
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
    convertDiffToEditor,
  } = useFileTabs(activeProjectPath, sessionId || '', handleOpenTab);

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

  // Width restoration is declarative: each panel's `defaultSize` comes from the
  // remembered width for its current slot and `Panel` adopts a change, so a
  // view switch needs no imperative push and no cached layout can go stale.

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategoryId>('appearance');
  const [autoOpenAddProvider, setAutoOpenAddProvider] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const handleRefreshWorkspace = () => setRefreshKey(k => k + 1);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const streamStatus = useAgentStreamStatus();

  // The navbar's title menu acts on the session on screen. Its row may live in
  // a folder that is not expanded in the sidebar, so the session is found by id
  // across every folder rather than by walking the visible list. No row means
  // nothing to act on — a session the sidebar does not know (a chat running
  // outside every registered workspace) gets no menu rather than dead items.
  const activeSession = useMemo(() => {
    if (!sessionId) return null;
    for (const folder of folders) {
      const found = (folder.sessions || []).find((s) => String(s.id) === String(sessionId));
      if (found) return found;
    }
    return null;
  }, [folders, sessionId]);
  const sidebar = useSidebarData();
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
  const { handleArchive, handleRename, handleRenameWithAi } = useSessionActions(sidebar.refresh, pushToast);
  const sessionDelete = useSessionDelete();
  // A pending `new-…` chat has no transcript anywhere yet, so rename and delete
  // are refused by the server; the menu hides them the way the sidebar does.
  const isPendingSession = Boolean(sessionId && sessionId.startsWith('new-'));
  const sessionActions = activeSession
    ? {
        isArchived: activeSession.is_archived === 1,
        onRename: isPendingSession ? undefined : (name: string) => void handleRename(activeSession, name),
        onRenameWithAi: isPendingSession ? undefined : () => void handleRenameWithAi(activeSession),
        onArchive: () => handleArchive(activeSession),
        onDelete: isPendingSession ? undefined : () => sessionDelete.requestDelete(activeSession),
      }
    : undefined;

  // The workspace shortcuts, from the shared keymap so the toggles' tooltips
  // name the bound chord. `⌘S` is absent: the editor owns it, and binding it
  // twice would save the file twice.
  useWorkspaceKeybindings({
    showEditor,
    editorHasContent,
    toggleSidebar: () => setShowLeftPanel((previous) => !previous),
    toggleEditor: () => setUserToggledEditor((previous) => !(previous ?? showEditor)),
    toggleRightPanel: () => setShowRightPanel((previous) => !previous),
    openSettings: () => {
      setSettingsCategory('appearance');
      setAutoOpenAddProvider(false);
      setSettingsOpen((previous) => !previous);
    },
  });

  // Global event listener for settings triggers
  useKabmoEvent('omp:open-settings', (e) => {
    const customEvent = e as CustomEvent<{ category?: SettingsCategoryId; autoOpenAdd?: boolean }>;
    if (customEvent.detail?.category) {
      setSettingsCategory(customEvent.detail.category);
    } else {
      setSettingsCategory('appearance');
    }
    setAutoOpenAddProvider(!!customEvent.detail?.autoOpenAdd);
    setSettingsOpen(true);
  });

  // Clicking the ACTIVE view on an open panel collapses that panel; any other
  // click selects and opens. One handler for both columns' rails.
  const handleChangeRightPanel = (panel: string) => {
    const collapsing = activeRightPanel === panel && showRightPanel;
    setShowRightPanel(!collapsing);
    if (!collapsing) setActiveRightPanel(panel);
  };

  const handleToggleLeftPanel = (show: boolean) => setShowLeftPanel(show);
  const handleToggleRightPanel = () => setShowRightPanel(!showRightPanel);
  const handleToggleEditor = () => setUserToggledEditor(!showEditor);

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
            open={showLeftPanel}
            railEnabled={dock.enabled}
            view={leftView}
            onSelectView={(panel) => {
              // A rail click means "show this view" — never "toggle" it. A
              // toggle would hide the rail the user is aiming at, and the dock
              // has its own collapse control in the header.
              setActiveLeftView(panel);
              if (!showLeftPanel) handleToggleLeftPanel(true);
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
                showLeftPanel={showLeftPanel}
                showEditor={showEditor}
                showRightPanel={showRightPanel}
                streamStatus={streamStatus}
                onSwitchToMobile={onSwitchToMobile}
                onToggleEditor={handleToggleEditor}
                onToggleRightPanel={handleToggleRightPanel}
                onToggleLeftPanel={() => handleToggleLeftPanel(!showLeftPanel)}
                sessionActions={sessionActions}
              />

              <WorkspacePanels
                appSettings={appSettings}
                showEditor={showEditor}
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
        isOpen={settingsOpen} 
        onClose={() => {
          setSettingsOpen(false);
          setAutoOpenAddProvider(false);
        }} 
        initialCategory={settingsCategory}
        autoOpenAddProvider={autoOpenAddProvider}
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
