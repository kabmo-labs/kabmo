import { useRef } from 'preact/hooks';
import { Suspense, lazy } from 'preact/compat';
import type { ReactNode, RefObject } from 'preact/compat';
import { Group, Panel, type PanelImperativeHandle } from '@/client/components/layout/desktop-layout/resizer';
import { ChatTimeline } from '@/client/components/workspace/chat-timeline/index';
import { usePanelCatalog, PluginPanelBody, usePanelSlotPlugins, type PanelBodyProps } from '@/client/components/workspace/plugin-panel/resolve';
import { EditorPluginRail } from '@/client/components/workspace/editor/PluginRail';
import { PanelHostProvider } from '@kabmo-labs/kabmo-ui';
import { ActivityBar } from '@/client/components/layout/ActivityBar';
import { useEditorDrop, type EditorDropResult } from '@/client/hooks/editor/use-editor-drop';
import { EditorDropOverlay } from '@/client/components/workspace/editor/EditorDropOverlay';
import { ResizeHandle } from '@/client/components/layout/desktop-layout/ResizeHandle';
import { useAvailableWidth } from '@/client/hooks/workspace/available-width';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import {
  HANDLE_WIDTH,
  MIN_EDITOR_PANEL_WIDTH,
  fillerMinWidth,
  type EditorWidthMode,
  type PanelWidths,
} from '@/shared/lib/workspace/panel-widths';
import { resolveWorkspacePanelWidths } from '@/shared/lib/workspace/workspace-panel-widths';

const Editor = lazy(() => import('@/client/components/workspace/editor/index').then((m) => ({ default: m.Editor })));

function PanelSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={
      <div className="w-full h-full flex items-center justify-center text-ink/40">
        <span className="text-xs font-mono">Loading…</span>
      </div>
    }>
      {children}
    </Suspense>
  );
}

interface WorkspacePanelsProps {
  appSettings?: Record<string, any>;
  showEditor: boolean;
  /**
   * The chat column is collapsed: the editor's compact/full view took its
   * width. The chat STAYS MOUNTED (it owns the live stream and the composer)
   * but is sized to nothing and marked inert, so a run in progress is not
   * thrown away by widening a document.
   */
  chatHidden?: boolean;
  editorPanelRef: RefObject<PanelImperativeHandle | null>;
  showRightPanel: boolean;
  /** A built-in view id or a plugin panel key (`plugin:<id>/<panel>`). */
  activeRightPanel: string;
  /** The `plugin:<id>` whose panel owns the editor column, or null. */
  activeEditorPanelKey: string | null;
  onSelectEditorPanel: (panelKey: string | null) => void;
  rightPanelRef: RefObject<PanelImperativeHandle | null>;
  /** Remembered width per panel, keyed the same way the layout reports them. */
  panelWidths: PanelWidths;
  /** Whether the editor panel currently shows a source file or a diff. */
  editorWidthMode: EditorWidthMode;
  hasActiveContext: boolean;
  activeProjectPath?: string | null;
  openedFiles: any[];
  activeFileId: number | string | null;
  refreshKey: number;
  onSetActiveFileId: (id: number | string | null) => void;
  onCloseFile: (id: number | string) => void;
  /** Replace a diff tab with the plain editor tab for the same file. */
  onConvertDiffToEditor: (id: number | string) => void;
  onOpenFile: (file: any) => void;
  onRefreshWorkspace: () => void;
  /** The tab strip's menu: reopen a closed tab, copy a path, reveal a file. */
  onReopenClosed?: () => boolean;
  reopenableCount?: () => number;
  onCopyPath?: (tab: import('@/shared/types/fs').OpenedFile) => void;
  onRevealInFiles?: (tab: import('@/shared/types/fs').OpenedFile) => void;
  /** The outcome of a file dropped on the chat or the editor, for the toasts. */
  onDropResult?: (result: EditorDropResult) => void;
  onChangeRightPanel: (panel: string) => void;
  onToggleRightPanel: () => void;
  onSessionTitle: (title: string | null) => void;
  onPanelWidths: (patch: PanelWidths) => void;
}

export function WorkspacePanels(props: WorkspacePanelsProps) {
  const {
    appSettings,
    showEditor,
    chatHidden = false,
    editorPanelRef,
    showRightPanel,
    activeRightPanel,
    activeEditorPanelKey,
    onSelectEditorPanel,
    rightPanelRef,
    panelWidths,
    editorWidthMode,
    hasActiveContext,
    activeProjectPath,
    openedFiles,
    activeFileId,
    refreshKey,
    onSetActiveFileId,
    onCloseFile,
    onConvertDiffToEditor,
    onOpenFile,
    onRefreshWorkspace,
    onReopenClosed,
    reopenableCount,
    onCopyPath,
    onRevealInFiles,
    onDropResult,
    onChangeRightPanel,
    onToggleRightPanel,
    onSessionTitle,
    onPanelWidths,
  } = props;

  /**
   * Dropping a file opens it — but only over the CHAT or the EDITOR.
   *
   * The handlers sit on those two panels' own boxes, so a drop over the sidebar
   * or the right panel never reaches them: the event bubbles past to the window
   * and is ignored. A layout-wide target was the previous shape and it accepted
   * a drop over both of those, where "open this file" is not what the surface
   * means.
   *
   * `enabled` is gated on a workspace being active: a path resolves through the
   * server's allow-list, so a drop with no workspace can only be refused, and a
   * target that lights up to refuse is worse than one that stays dark.
   */
  const drop = useEditorDrop({ enabled: hasActiveContext, onResult: onDropResult });

  // The group's own area: the base every stored fraction is a share of, and the
  // budget the chat floor is subtracted from. Measured through the group's
  // element, not a wrapper — the wrapper also spans the activity bar, which is
  // not area any panel may take.
  const groupRef = useRef<HTMLDivElement>(null);
  const available = useAvailableWidth(groupRef);

  // ONE catalog for both kinds of panel. The list is memoised per render pass
  // and the components inside it are `lazy()` at module scope, so switching the
  // right panel toggles CSS visibility instead of unmounting: a view's state
  // (tree expansion, search results, terminal buffer) survives switches and no
  // panel re-fetches its data just because the user looked away.
  const catalog = usePanelCatalog();
  const { sessionId } = useSessionStateContext();
  const activePanel = catalog.find((panel) => panel.id === activeRightPanel);
  // The EDITOR column's plugin slot (`panel`): a takeover, so it has no tab in
  // the strip and this rail is its only switch. Empty until a plugin registers
  // one, which is why a Kabmo without one looks exactly as it did.
  const editorPlugins = usePanelSlotPlugins();

  // The active view's own floor and defaults are read here and handed to the
  // resolver: a view that is switched off (or a plugin that has not loaded) has
  // no entry, and the right panel falls back to the editor's own floor — it
  // renders the notice, not a view.
  const {
    editor: editorWidth,
    right: rightWidth,
    editorMax: editorMaxSize,
    rightMax: rightMaxSize,
    rightMin: rightPanelMin,
    handleCount,
  } = resolveWorkspacePanelWidths({
      available,
      panelWidths,
      editorWidthMode,
      activeRightPanel,
      activePanel,
      showEditor,
      showRightPanel,
      chatHidden,
    });

  /**
   * Widths of the fixed panels as they are right now, keyed by slot: the
   * editor (source or diff, whichever is showing) and the right panel under
   * the view it currently holds. The chat column is the group's filler, so it
   * has no width of its own to report.
   *
   * Each is stored as a share of the area it was measured in, so the layout
   * follows a window resize instead of holding a pixel value that was only
   * right on the display it was dragged on.
   */
  const readPanelWidths = (): PanelWidths => {
    const patch: PanelWidths = {};
    const editor = editorPanelRef.current?.getSize()?.inPixels;
    const right = rightPanelRef.current?.getSize()?.inPixels;
    // With the chat hidden the editor's width is whatever is left over, not a
    // choice — persisting it would overwrite the width the user set for the
    // ordinary layout with the one this mode produced. A drag made here still
    // moves the RIGHT panel, which is the width that was actually chosen.
    if (!chatHidden && editor != null && editor > 0) {
      patch[editorWidthMode] = { px: Math.round(editor), ...(available ? { fraction: editor / available } : {}) };
    }
    if (right != null && right > 0) {
      patch.right = {
        [activeRightPanel]: { px: Math.round(right), ...(available ? { fraction: right / available } : {}) },
      };
    }
    return patch;
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <Group
        orientation="horizontal"
        id="kabmo-layout"
        className="flex-1 min-w-0"
        groupRef={groupRef}
        onLayoutChanged={() => {
          // Persist only real drags: imperative restores and constraint
          // recomputes would otherwise rewrite the saved widths with the
          // clamped sizes they just derived from them.
          onPanelWidths(readPanelWidths());
        }}
      >
        <Panel
          id="center-panel"
          filler
          // Collapsed — not unmounted — in compact/full view: the chat holds the
          // live run, the composer draft and the scroll position, and widening a
          // document must not discard any of them.
          collapsed={chatHidden}
          minSize={fillerMinWidth({
            available,
            reservedPx:
              (showEditor ? editorWidth : 0) +
              (showRightPanel ? rightWidth : 0) +
              handleCount * HANDLE_WIDTH,
          })}
        >
          <div className="relative w-full h-full" {...drop.dropProps} {...drop.captureDropProps} inert={chatHidden}>
            <EditorDropOverlay visible={drop.isDragging} />
            <ChatTimeline className="w-full h-full" appSettings={appSettings} onSessionTitle={onSessionTitle} />
          </div>
        </Panel>

        {showEditor && !chatHidden && <ResizeHandle />}
        <Panel panelRef={editorPanelRef} id="editor-panel" defaultSize={editorWidth} minSize={MIN_EDITOR_PANEL_WIDTH} maxSize={editorMaxSize} collapsed={!showEditor}>
          <div className="flex w-full h-full" {...drop.dropProps} {...drop.captureDropProps}>
            <EditorDropOverlay visible={drop.isDragging} />
            <EditorPluginRail
              activeKey={activeEditorPanelKey}
              onSelect={onSelectEditorPanel}
              plugins={editorPlugins}
            />
            <div className="relative flex-1 min-w-0 h-full">
            <PanelSuspense>
            <Editor
              className="w-full h-full"
              activeEditorPanelKey={activeEditorPanelKey}
              openedFiles={openedFiles}
              activeFileId={activeFileId}
              onSelectFile={onSetActiveFileId}
              onCloseFile={onCloseFile}
              onConvertDiffToEditor={onConvertDiffToEditor}
              refreshKey={refreshKey}
              onFileSaved={onRefreshWorkspace}
              // Quick open answers workspace-relative paths, so it goes through the
              // same opener every other surface uses — one id scheme per path.
              onOpenPath={(path) => onOpenFile({ path, name: path.split('/').pop() ?? path })}
              rootPath={activeProjectPath ?? null}
              onReopenClosed={onReopenClosed}
              reopenableCount={reopenableCount}
              onCopyPath={onCopyPath}
              onRevealInFiles={onRevealInFiles}
            />
            </PanelSuspense>
            </div>
          </div>
        </Panel>

        {showRightPanel && <ResizeHandle />}
        <Panel panelRef={rightPanelRef} id="right-panel" defaultSize={rightWidth} minSize={rightPanelMin} maxSize={rightMaxSize} collapsed={!showRightPanel}>
          <PanelSuspense>
            {/* ONE renderer for both kinds of panel. Each view stays MOUNTED
                while another is on screen (hidden with CSS), so a tree's
                expansion, a search's results and a terminal's buffer survive a
                switch. A plugin panel is mounted only while it is the active
                one: a hidden plugin is a component nobody is looking at, and
                the host owns no state of its own to preserve. */}
            {catalog.map((panel) => {
              const isActiveView = activeRightPanel === panel.id;
              if (!panel.builtin && !isActiveView) return null;
              const body: PanelBodyProps = {
                className: 'w-full h-full',
                sessionId,
                // A view that stays live while hidden keeps reading even when
                // another view is on screen — the terminal owns a live PTY and
                // swapping it to the placeholder mid-command would drop the
                // stream. Everything else polls only while shown.
                enabled: panel.liveWhileHidden
                  ? hasActiveContext
                  : hasActiveContext && isActiveView,
                active: isActiveView,
                refreshKey,
                ...(activeProjectPath ? { rootPath: activeProjectPath } : {}),
                onRefresh: onRefreshWorkspace,
                onOpenFile,
                onClose: onToggleRightPanel,
              };
              return (
                <div key={panel.id} className={isActiveView ? 'w-full h-full' : 'hidden'}>
                  <PanelHostProvider value={body}>{panel.render(body)}</PanelHostProvider>
                </div>
              );
            })}
            {/* The selection names a panel that is switched off, uninstalled, or
                whose bundle has not loaded — a notice, never a blank column. */}
            {!activePanel ? (
              <div className="w-full h-full">
                <PluginPanelBody panelKey={activeRightPanel} />
              </div>
            ) : null}
          </PanelSuspense>
        </Panel>
      </Group>

      <ActivityBar side="right" activePanel={activeRightPanel} onChangePanel={onChangeRightPanel} isPanelOpen={showRightPanel} hasActiveContext={hasActiveContext} activeProjectPath={activeProjectPath} />
    </div>
  );
}
