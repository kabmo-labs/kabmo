import { useEffect, useRef } from 'preact/hooks';
import { lazy } from 'preact/compat';
import type { RefObject } from 'preact/compat';
import { Group, Panel, type PanelImperativeHandle } from '@/client/components/layout/desktop-layout/resizer';
import { PanelSuspense } from '@/client/components/layout/desktop-layout/PanelSuspense';
import { ChatTimeline } from '@/client/components/workspace/chat-timeline/index';
import { usePanelCatalog, usePanelSlotPlugins } from '@/client/components/workspace/plugin-panel/resolve';
import { EditorPluginRail } from '@/client/components/workspace/editor/PluginRail';
import { ActivityBar } from '@/client/components/layout/ActivityBar';
import { useEditorDrop, type EditorDropResult } from '@/client/hooks/editor/use-editor-drop';
import { EditorDropOverlay } from '@/client/components/workspace/editor/EditorDropOverlay';
import { ResizeHandle } from '@/client/components/layout/desktop-layout/ResizeHandle';
import { RightColumn } from '@/client/components/layout/desktop-layout/RightColumn';
import type { PanelNavStyle } from '@/shared/lib/workspace/panel-nav';
import { useAvailableWidth } from '@/client/hooks/workspace/available-width';
import {
  HANDLE_WIDTH,
  MIN_EDITOR_PANEL_WIDTH,
  fillerMinWidth,
  type EditorWidthMode,
  type PanelWidths,
} from '@/shared/lib/workspace/panel-widths';
import { resolveWorkspacePanelWidths } from '@/shared/lib/workspace/workspace-panel-widths';

const Editor = lazy(() => import('@/client/components/workspace/editor/index').then((m) => ({ default: m.Editor })));

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
  /**
   * The whole right side is on screen. When it is not, the activity rail goes
   * with the panels: the rail is how a view is CHOSEN, and a rail beside two
   * collapsed columns is a column of marks that switches nothing.
   */
  showRightSide: boolean;
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
  /** A panel body's own close control: the right column only. */
  onCloseRightPanel: () => void;
  /**
   * How the right column is navigated, when the rail is on: `rail` draws the
   * 44px activity bar, `tabs` draws the browser-style strip over a home page.
   * The DOM decides which is mounted; the setting decides what `tabs` means.
   */
  rightNav: PanelNavStyle;
  /** An explicit "open this view" for the right column; see `RightColumnProps`. */
  rightOpenRequest?: { panelKey: string; nonce: number } | null;
  /** The editor panel's corner control: put the editor column away. */
  onHideEditor: () => void;
  onSessionTitle: (title: string | null) => void;
  onPanelWidths: (patch: PanelWidths) => void;
  /**
   * The right panel is asked for but the group has no room for it.
   *
   * Reported upward because the CONTROL that asked lives in the navbar: a
   * toggle that flips a flag this layout ignores reads as a dead button, so the
   * owner of the flag is the one that has to explain the refusal.
   */
  onRightPanelSuppressed?: (suppressed: boolean | null) => void;
}

export function WorkspacePanels(props: WorkspacePanelsProps) {
  const {
    appSettings,
    showEditor,
    chatHidden = false,
    editorPanelRef,
    showRightPanel,
    showRightSide,
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
    onCloseRightPanel,
    rightNav,
    rightOpenRequest,
    onHideEditor,
    onSessionTitle,
    onPanelWidths,
    onRightPanelSuppressed,
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
  // A stored selection can name a view the user has just placed on the LEFT
  // rail — the right column then holds no such panel. Falling back to the first
  // view it does hold is what the phone's drawer already does, and it keeps a
  // move from leaving a "not available" notice in a column that has views. A
  // PANEL THAT DOES NOT EXIST still gets the notice, which is a different fact.
  const allPanels = usePanelCatalog('all');
  const movedToLeft = allPanels.some((panel) => panel.id === activeRightPanel && panel.side === 'left');
  const activePanel = catalog.find((panel) => panel.id === activeRightPanel) ?? (movedToLeft ? catalog[0] : undefined);
  const shownRightPanel = activePanel?.id ?? activeRightPanel;
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
    rightShown: rightPanelShown,
    rightSuppressed,
    editorMax: editorMaxSize,
    rightMax: rightMaxSize,
    rightMin: rightPanelMin,
    handleCount,
  } = resolveWorkspacePanelWidths({
      available,
      panelWidths,
      editorWidthMode,
      activeRightPanel: shownRightPanel,
      activePanel,
      showEditor,
      showRightPanel,
      chatHidden,
    });

  // The owner of the flag is the navbar's toggle, so the refusal travels up:
  // a click that changes nothing visible is the defect this exists to prevent.
  // `null` before the group is measured, so the first suppression of a load can
  // be told apart from a panel being taken away.
  useEffect(() => {
    // `0` is the pre-measurement area as much as `null` is: the observer reports
    // it on the first frame, and the resolver answers "fits" for both.
    onRightPanelSuppressed?.(available == null || available <= 0 ? null : rightSuppressed);
  }, [available, rightSuppressed, onRightPanelSuppressed]);

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
        [shownRightPanel]: { px: Math.round(right), ...(available ? { fraction: right / available } : {}) },
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
              (rightPanelShown ? rightWidth : 0) +
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
              onHidePanel={onHideEditor}
            />
            </PanelSuspense>
            </div>
          </div>
        </Panel>

        {rightPanelShown && <ResizeHandle />}
        <RightColumn
          panelRef={rightPanelRef}
          open={rightPanelShown}
          width={rightWidth}
          minWidth={rightPanelMin}
          maxWidth={rightMaxSize}
          catalog={catalog}
          shownPanel={shownRightPanel}
          selectedPanel={activeRightPanel}
          activePanelFound={Boolean(activePanel)}
          hasActiveContext={hasActiveContext}
          activeProjectPath={activeProjectPath}
          refreshKey={refreshKey}
          onRefresh={onRefreshWorkspace}
          onOpenFile={onOpenFile}
          onClose={onCloseRightPanel}
          navStyle={rightNav}
          onSelectPanel={onChangeRightPanel}
          {...(rightOpenRequest ? { openRequest: rightOpenRequest } : {})}
        />
      </Group>

      {/* The rail is how a view is CHOSEN, so it goes with the panel it
          chooses: a rail beside a suppressed panel is a column of marks that
          switches nothing (and 44px the chat cannot spare). */}
      {showRightSide && rightPanelShown && rightNav === 'rail' && (
        <ActivityBar side="right" activePanel={shownRightPanel} onChangePanel={onChangeRightPanel} isPanelOpen={rightPanelShown} hasActiveContext={hasActiveContext} activeProjectPath={activeProjectPath} />
      )}
    </div>
  );
}
