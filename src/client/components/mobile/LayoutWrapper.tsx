import { useCallback, useState } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { useChamberEvent } from '@/client/hooks/ui/window-event';
import type { SettingsCategoryId } from '@/shared/types';
import { MobileMainView } from '@/client/components/mobile/MainView';
import { MobileSessionSidebar } from '@/client/components/mobile/SessionSidebar';
import { MobileRightSidebar } from '@/client/components/mobile/RightSidebar';
import { MobileFullEditor } from '@/client/components/mobile/mobile-right-sidebar/FullEditor';
import { MobileFullDiff } from '@/client/components/mobile/mobile-right-sidebar/FullDiff';
import { SettingsModal } from '@/client/components/settings/LazyModal';
import { activeProjectForSession } from '@/shared/lib/workspace/active-project';
import { spawnCwdForNewSession, triggerSessionPrewarm } from '@/shared/lib/omp/session/prewarm';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { useMissingFiles } from '@/client/hooks/workspace/missing-files';
import { startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import { useToasts } from '@/client/hooks/ui/toasts';
import { ToastStack } from '@/client/components/common/ToastStack';
import { useEditorDrop, type EditorDropResult } from '@/client/hooks/editor/use-editor-drop';
import { EditorDropOverlay } from '@/client/components/workspace/editor/EditorDropOverlay';
import { mobileEditorFileFrom, type MobileEditorFile } from '@/client/components/mobile/open-file-payload';

interface MobileLayoutWrapperProps {
  onDesktopToggle?: () => void;
  appSettings?: Record<string, any>;
}

export type MobileScreen = 'main' | 'session' | 'right';

export function MobileLayoutWrapper({ onDesktopToggle, appSettings = {} }: MobileLayoutWrapperProps) {
  const { folders } = useSidebarData();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionParam = searchParams.get('sessionId');
  const sessionId = sessionParam ? (Number.isNaN(Number(sessionParam)) ? sessionParam : Number(sessionParam)) : null;
  const folderParam = searchParams.get('folderId');
  const folderId = folderParam ? (Number.isNaN(Number(folderParam)) ? folderParam : Number(folderParam)) : null;

  const [currentScreen, setCurrentScreen] = useState<MobileScreen>('main');
  const [mobileEditorFile, setMobileEditorFile] = useState<MobileEditorFile | null>(null);
  const [mobileDiff, setMobileDiff] = useState<{ path: string; status?: string; staged?: boolean; repo?: string; root?: string } | null>(null);
  // Bumped whenever a write lands so the workspace panels (explorer, git,
  // context) re-read from disk — the same signal the desktop layout passes down.
  const [refreshKey, setRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategoryId>('appearance');
  const [autoOpenAddProvider, setAutoOpenAddProvider] = useState(false);

  const handleWorkspaceChanged = useCallback(() => setRefreshKey(k => k + 1), []);

  // The phone's full-screen editor shows ONE file at a time, so the probe has a
  // single subject and a constant id. `refreshKey` is what carries a deletion
  // here: the Files panel's delete, an agent `rm` that triggers a workspace
  // refresh, and the editor's own save all bump it.
  const mobileEditorMissingIds = useMissingFiles(
    mobileEditorFile?.path
      ? [{ id: 'mobile-editor', path: mobileEditorFile.path, root: mobileEditorFile.root }]
      : [],
    refreshKey,
  );
  const { toasts, pushToast, dismissToast } = useToasts();
  const handleDropResult = useCallback(
    (result: EditorDropResult) => pushToast(result.message, result.ok ? 'success' : 'error'),
    [pushToast],
  );
  const mobileEditorMissing = mobileEditorMissingIds.size > 0;

  const { folder: sessionFolder } = activeProjectForSession(folders, sessionId);
  const contextFolder = sessionFolder ?? (folderId ? folders.find(f => String(f.id) === String(folderId)) ?? null : null);
  const activeProjectPath = contextFolder?.project_path ?? null;
  const hasContext = !!contextFolder;

  // A phone drop is rare but real (an iPad with a trackpad). The target is the
  // whole layout, for the same reason the desktop one is: the full-screen
  // editor is mounted only once a file is open, so a target scoped to it could
  // never receive the first drop.
  const editorDrop = useEditorDrop({ enabled: hasContext, onResult: handleDropResult });

  // Listen to open-file event on mobile
  useChamberEvent('omp:open-file', (e) => {
    const customEvent = e as CustomEvent<unknown>;
    const next = mobileEditorFileFrom(customEvent.detail);
    if (next) setMobileEditorFile(next);
  });

  // The git panel and the file explorer announce a diff through
  // `omp:open-diff`, which the desktop layout turns into an editor tab. On the
  // phone the same event opens the full-screen diff; without a listener here
  // the tap was silently dropped.
  useChamberEvent('omp:open-diff', (e) => {
    const detail = (e as CustomEvent<{ file?: string; status?: string; staged?: boolean; repo?: string; root?: string }>).detail;
    if (!detail?.file) return;
    setMobileDiff({
      path: detail.file.replace(/^\/+/, ''),
      status: detail.status,
      staged: detail.staged,
      repo: detail.repo,
      root: detail.root ?? activeProjectPath ?? undefined,
    });
  });

  // A roster row opens a subagent transcript in the chat timeline (the
  // `omp:view-subagent` listener there owns the URL). On the phone the chat is
  // a separate screen, so the tap must also bring it forward — otherwise the
  // transcript opens behind the drawer and the tap reads as a no-op.
  useChamberEvent('omp:view-subagent', () => setCurrentScreen('main'));

  // Settings requests (e.g. the model dropdown asking for Settings → Providers
  // when no provider is configured) arrive on the same global channel the
  // desktop layout listens on. SettingsModal itself only reads the payload and
  // never opens, so the open has to be handled here.
  useChamberEvent('omp:open-settings', (e) => {
    const detail = (e as CustomEvent<{ category?: SettingsCategoryId; autoOpenAdd?: boolean }>).detail;
    setSettingsCategory(detail?.category ?? 'appearance');
    setAutoOpenAddProvider(Boolean(detail?.autoOpenAdd));
    setSettingsOpen(true);
  });

  const handleSelectSession = (id: number | string) => {
    setSearchParams(prev => {
      prev.set('sessionId', id.toString());
      // Navigating away from a session must also exit its transcript view.
      if (prev.has('subagent')) prev.delete('subagent');
      return prev;
    }, { replace: true });
    setCurrentScreen('main');
  };

  // Mirrors the desktop sidebar: a client-side pending session (`new-…`) that
  // the chat timeline replaces with the real omp session id on first send.
  // The current folder stays selected so the composer keeps its context.
  const handleNewSession = () => {
    // Same resolution the send path uses (active session's folder, else the
    // URL folderId) so the prewarmed cwd matches the eventual spawn cwd.
    const cwd = spawnCwdForNewSession(folders, sessionParam, folderId ?? undefined);
    if (cwd) triggerSessionPrewarm(cwd);
    setSearchParams(prev => {
      const currentSessionId = prev.get('sessionId');
      const next = new URLSearchParams(prev);
      const currentFolder = currentSessionId
        ? folders.find(f => f.sessions?.some((s) => String(s.id) === String(currentSessionId)))
        : undefined;
      next.set('sessionId', startPendingSession(currentFolder?.id ?? folderId ?? null));
      if (currentFolder) next.set('folderId', currentFolder.id.toString());
      return next;
    }, { replace: true });
    setCurrentScreen('main');
  };

  // Desktop parity: the `+` on a workspace header creates the pending session
  // INSIDE that folder, so the prewarmed cwd and the eventual spawn cwd are the
  // folder's — not whatever the active session resolved to.
  const handleNewSessionForFolder = (targetFolderId: number) => {
    const cwd = spawnCwdForNewSession(folders, sessionParam, targetFolderId);
    if (cwd) triggerSessionPrewarm(cwd);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('sessionId', startPendingSession(targetFolderId));
      next.set('folderId', targetFolderId.toString());
      return next;
    }, { replace: true });
    setCurrentScreen('main');
  };

  const handleOpenFile = useCallback((file: unknown) => {
    const next = mobileEditorFileFrom(file, activeProjectPath);
    if (next) setMobileEditorFile(next);
  }, [activeProjectPath]);

  return (
    <div
      data-testid="app-root"
      className="flex flex-col h-dvh w-screen overflow-hidden bg-canvas text-ink font-sans selection:bg-ink selection:text-canvas relative"
    >
      {/* The drop target is the CHAT screen only, matching the desktop: the
          session drawer and the right panel are their own screens here, and
          "open this file" is not what either of them means. The full-screen
          editor owns its own target (it covers this one when open). */}
      <div
        className={`flex-1 min-h-0 w-full relative ${currentScreen === 'main' ? 'block' : 'hidden'}`}
        {...editorDrop.dropProps}
      >
        <EditorDropOverlay visible={editorDrop.isDragging} />
        <MobileMainView
          activeSessionId={sessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onOpenSessionSidebar={() => setCurrentScreen('session')}
          onOpenRightSidebar={() => setCurrentScreen('right')}
          appSettings={appSettings}
        />
      </div>

      <div className={`flex-1 min-h-0 w-full ${currentScreen === 'session' ? 'block' : 'hidden'}`}>
        <MobileSessionSidebar
          activeSessionId={sessionId}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onNewSessionForFolder={handleNewSessionForFolder}
          onClose={() => setCurrentScreen('main')}
          onDesktopToggle={onDesktopToggle}
          appSettings={appSettings}
        />
      </div>

      {/* Mounted only while the drawer is open: its panels (explorer, git,
          terminal, context) cost real CPU and fetch real data — a hidden
          phone drawer must not keep them alive behind the chat screen. The
          session screen above stays mounted on purpose: its status-ack effect
          must run even while the drawer is closed, and its stream poll is
          already inert when nothing is running. */}
      {currentScreen === 'right' && (
        <div className="flex-1 min-h-0 w-full">
          <MobileRightSidebar
            enabled={hasContext}
            rootPath={activeProjectPath ?? undefined}
            refreshKey={refreshKey}
            onRefresh={handleWorkspaceChanged}
            onOpenFile={handleOpenFile}
            onClose={() => setCurrentScreen('main')}
          />
        </div>
      )}

      {mobileEditorFile && (
        <MobileFullEditor
          file={mobileEditorFile}
          missing={mobileEditorMissing}
          onClose={() => setMobileEditorFile(null)}
          onFileSaved={handleWorkspaceChanged}
        />
      )}

      {mobileDiff && (
        <MobileFullDiff
          diff={mobileDiff}
          onClose={() => setMobileDiff(null)}
          onFileSaved={handleWorkspaceChanged}
        />
      )}

      {/* Single settings modal for the mobile layout, fed by omp:open-settings
          and by the sidebar's Settings button. */}
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
      {/* A drop on the full-screen editor either opens a file or is refused, and
          the refusal names why. The phone's own toast stack lives in the
          drawer, which is closed while the editor is up — so this layout needs
          its own or the answer would go nowhere. */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
