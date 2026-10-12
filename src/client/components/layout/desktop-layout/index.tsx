import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { Group, Panel, type PanelImperativeHandle } from '@/client/components/layout/desktop-layout/resizer';
import { SessionSidebar } from '@/client/components/layout/session-sidebar/index';
import { SettingsModal } from '@/client/components/settings/LazyModal';
import type { SettingsCategoryId } from '@/shared/types';
import { activeProjectForSession } from '@/shared/lib/workspace/active-project';
import { useFileTabs } from '@/client/hooks/workspace/file-tabs';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { TopNavbar } from '@/client/components/layout/desktop-layout/TopNavbar';
import { WorkspacePanels } from '@/client/components/layout/desktop-layout/WorkspacePanels';
import { useAgentStreamStatus } from '@/client/hooks/chat/omp/status';
import { usePanelWidths } from '@/client/hooks/workspace/panel-widths';
import { useSidebarWidth } from '@/client/hooks/workspace/sidebar-width';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { MAX_LEFT_PANEL_WIDTH, MIN_LEFT_PANEL_WIDTH } from '@/shared/lib/workspace/sidebar-width';
import type { EditorWidthMode } from '@/shared/lib/workspace/panel-widths';
import { ResizeHandle } from '@/client/components/layout/desktop-layout/ResizeHandle';
import { useChamberEvent, useWindowEvent } from '@/client/hooks/ui/window-event';
import { PluginBootstrap } from '@/client/lib/plugins/bootstrap';
import { WORKSPACE_KEY_BINDINGS } from '@/shared/lib/workspace/keymap';
import { resolveBinding } from '@/shared/lib/ui/key-binding';
import { useToasts } from '@/client/hooks/ui/toasts';
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
  const { widths: panelWidths, commitWidths } = usePanelWidths();
  // The sidebar's width is the one panel width that is NOT per session: it
  // lists the same sessions in every chat, so it lives in `app_settings`.
  const [sidebarWidth, commitSidebarWidth] = useSidebarWidth();

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

  const showEditor = openedFiles.length > 0 && (userToggledEditor ?? true);

  // A diff wants room a source file does not, so the editor panel keeps a
  // separate remembered width per tab kind.
  const editorWidthMode: EditorWidthMode = useMemo(
    () => (openedFiles.find(f => String(f.id) === String(activeFileId))?.isDiff ? 'diff' : 'editor'),
    [openedFiles, activeFileId],
  );

  // Width restoration is declarative: every panel's `defaultSize` is derived
  // from the remembered width for its current slot, and `Panel` adopts a
  // changed `defaultSize` itself. That covers the two cases that used to need
  // an imperative push — a right-panel view switch and an editor source↔diff
  // switch, both of which keep the panel mounted while only its width slot
  // changes — and it cannot go stale, because there is no cached layout to
  // disagree with the props.

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

  /**
   * The workspace's own shortcuts, resolved from the shared keymap so the
   * tooltips on the panel toggles name the chord that is actually bound.
   *
   * `⌘S` is deliberately absent here: the editor panel already owns it (it is
   * the only surface with a buffer to save), and binding it twice would save
   * the file twice.
   */
  useWindowEvent('keydown', (e) => {
    const command = resolveBinding(WORKSPACE_KEY_BINDINGS, e);
    if (!command) return;
    if (command === 'saveFile') return;
    if (command === 'toggleEditorPanel' && !showEditor) {
      // The editor panel is only meaningful with a file open, and `showEditor`
      // already folds in the user's own toggle.
      if (openedFiles.length === 0) return;
    }
    e.preventDefault();
    if (command === 'toggleSidebar') setShowLeftPanel((previous) => !previous);
    else if (command === 'toggleEditorPanel') setUserToggledEditor((previous) => !(previous ?? showEditor));
    else if (command === 'toggleRightPanel') setShowRightPanel((previous) => !previous);
    else if (command === 'openSettings') {
      setSettingsCategory('appearance');
      setAutoOpenAddProvider(false);
      setSettingsOpen((previous) => !previous);
    }
  });

  // Global event listener for settings triggers
  useChamberEvent('omp:open-settings', (e) => {
    const customEvent = e as CustomEvent<{ category?: SettingsCategoryId; autoOpenAdd?: boolean }>;
    if (customEvent.detail?.category) {
      setSettingsCategory(customEvent.detail.category);
    } else {
      setSettingsCategory('appearance');
    }
    setAutoOpenAddProvider(!!customEvent.detail?.autoOpenAdd);
    setSettingsOpen(true);
  });

  const handleChangeRightPanel = (panel: string) => {
    let nextShow = showRightPanel;
    let nextActive = activeRightPanel;

    if (activeRightPanel === panel && showRightPanel) {
      nextShow = false;
    } else {
      nextActive = panel;
      nextShow = true;
    }

    setShowRightPanel(nextShow);
    setActiveRightPanel(nextActive);
  };

  const handleToggleLeftPanel = (show: boolean) => {
    setShowLeftPanel(show);
  };

  const handleToggleRightPanel = () => {
    setShowRightPanel(!showRightPanel);
  };

  /**
   * Open a plugin's view in the editor column.
   *
   * The column is the SECOND place a view can live, so this is the one place
   * that knows about both: it makes the plugin the active right panel (which is
   * what the column resolves against) and opens the editor column. There is no
   * tab to add — the plugin takes the whole surface.
   */
  const handleOpenPluginPanel = (panelKey: string) => {
    setActiveRightPanel(panelKey);
    setUserToggledEditor(true);
  };

  const handleToggleEditor = () => {
    setUserToggledEditor(!showEditor);
    // The editor panel keeps its own remembered width per tab kind, so a
    // dragged width survives the toggle without being re-applied here.
  };

  return (
    <div
      data-testid="app-root"
      className="flex flex-col h-screen w-screen overflow-hidden bg-canvas text-ink font-sans selection:bg-ink selection:text-canvas"
    >

      {/* Main Workspace: full-height left sidebar (resizable) + right stack */}
      <div className="flex flex-1 overflow-hidden">
        <Group
          orientation="horizontal"
          id="ompchamber-main"
          onLayoutChanged={() => {
            const left = leftPanelRef.current?.getSize()?.inPixels;
            if (left != null && left > 0) commitSidebarWidth(Math.round(left));
          }}
        >
          <Panel panelRef={leftPanelRef} id="left-panel" defaultSize={sidebarWidth} minSize={MIN_LEFT_PANEL_WIDTH} maxSize={MAX_LEFT_PANEL_WIDTH} collapsed={!showLeftPanel}>
            <SessionSidebar className="w-full h-full" onClose={() => handleToggleLeftPanel(false)} appSettings={appSettings} streamStatus={streamStatus} />
          </Panel>
          {showLeftPanel && <ResizeHandle />}

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
                onOpenPluginPanel={handleOpenPluginPanel}
                sessionActions={sessionActions}
              />

              <WorkspacePanels
                appSettings={appSettings}
                showEditor={showEditor}
                editorPanelRef={editorPanelRef}
                showRightPanel={showRightPanel}
                activeRightPanel={activeRightPanel}
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
