/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The desktop's left column: the optional rail, the dock, its furniture, and
 * its separator.
 *
 * Split out of `DesktopLayout` because the column has four parts that answer
 * four different questions — whether the rail is drawn (a global preference),
 * which view is on screen (per session), how wide the column is (per view), and
 * what belongs to the COLUMN rather than to a view — and the layout component is
 * where the group's own width arithmetic lives.
 *
 * Four rules are load-bearing, and each was a defect first:
 *
 * - **The rail is INSIDE the column's panel**, not a sibling of it. It used to
 *   be a sibling, which made it a panel of its own: the group's width arithmetic
 *   had to budget for a third fixed panel, and — the bug that was reported — the
 *   footer could only be as wide as the dock BODY, so turning the rail on left a
 *   strip under the rail with nothing in it.
 * - **The rail sits BETWEEN the title row and the footer**, never above them.
 *   The column reads top-to-bottom as title · (rail | view) · strip, so the rail
 *   cannot run up into the app's titlebar and cannot outlive the strip.
 * - **The footer spans the whole column.** Settings · About act on Kabmo, not on
 *   the view above them, so a plugin panel on the dock must not take them away
 *   and the strip must not shrink to one view's width.
 * - **The rail exists only while the user turned it on** (`left-dock.ts`). Off —
 *   the default — means no rail and the column is the session list as it always
 *   was.
 * - **The column's body is always mounted** (the panel collapses to zero width),
 *   so the session list's expansion, scroll and batch selection survive a
 *   collapse and the width transition has something to animate.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { RefreshCw } from 'lucide-preact';
import { Panel, type PanelImperativeHandle } from '@/client/components/layout/desktop-layout/resizer';
import { ActivityBar } from '@/client/components/layout/ActivityBar';
import { LeftDockView } from '@/client/components/layout/LeftDock';
import { PanelTabsColumn } from '@/client/components/workspace/panel-tabs';
import { usePanelCatalog } from '@/client/components/workspace/plugin-panel/catalog';
import { usePanelTabs } from '@/client/hooks/workspace/panel-tabs';
import { useRevealEdge, useRevealPanelTab } from '@/client/hooks/workspace/panel-tabs-reveal';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';
import type { PanelNavStyle } from '@/shared/lib/workspace/panel-nav';
import { useLeftDock } from '@/client/hooks/workspace/left-dock';
import { usePanelDropTarget } from '@/client/hooks/workspace/panel-drop-target';
import { ResizeHandle } from '@/client/components/layout/desktop-layout/ResizeHandle';
import { AboutModal } from '@/client/components/layout/session-sidebar/about-modal';
import { UpdatePopup } from '@/client/components/layout/update-popup';
import { SettingsModal } from '@/client/components/settings/LazyModal';
import { SessionSidebarFooter } from '@/client/components/layout/session-sidebar/Footer';
import { SessionSidebarHeader } from '@/client/components/layout/session-sidebar/Header';
import { useShellOffer } from '@/client/hooks/ui/updates/shell-download';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useUpdates } from '@/client/hooks/ui/updates';
import { UPDATE_REQUEST_EVENT } from '@/shared/lib/updates/popup-state';
import { useUpdateCheckRequest } from '@/client/hooks/ui/updates/check-request';
import { openKeyBindingHelp } from '@/client/lib/commands/overlays';
import { MAX_LEFT_PANEL_WIDTH } from '@/shared/lib/workspace/sidebar-width';
import { updateOutcomeTone } from '@/shared/lib/ui/toast-duration';
import type { AgentStreamStatus } from '@/shared/lib/chat/omp/status';

interface LeftColumnProps {
  panelRef: RefObject<PanelImperativeHandle | null>;
  open: boolean;
  /** Draw the rail. A global preference, off by default. */
  railEnabled: boolean;
  /**
   * How this column is navigated when the rail is on: `rail` draws the 44px
   * activity bar, `tabs` draws the browser-style strip and its home page.
   *
   * The rail's own switch still decides whether the column has ANY navigation
   * furniture — a user who never placed a panel on the dock keeps the plain
   * session list, and switching the style cannot conjure a strip out of it.
   */
  navStyle: PanelNavStyle;
  /** The view the dock actually shows, after resolving the stored selection. */
  view: string;
  onSelectView: (view: string) => void;
  onCollapse: () => void;
  width: number;
  minWidth: number;
  hasActiveContext: boolean;
  activeProjectPath?: string | null;
  /** The active session, for a built-in view the user placed on the dock. */
  sessionId?: string | null;
  appSettings?: Record<string, any>;
  streamStatus?: AgentStreamStatus;
  refreshKey: number;
  onRefresh: () => void;
  onOpenFile: (file: unknown) => void;
  /** Dev-only layout switch, drawn in the footer beside the phone's mirror. */
  onMobileToggle?: () => void;
}

export function LeftColumn({
  panelRef,
  open,
  railEnabled,
  navStyle,
  view,
  onSelectView,
  onCollapse,
  width,
  minWidth,
  hasActiveContext,
  activeProjectPath,
  sessionId,
  appSettings = {},
  streamStatus,
  refreshKey,
  onRefresh,
  onOpenFile,
  onMobileToggle,
}: LeftColumnProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // With the rail OFF there is no rail to drop on, so the column BODY is the
  // destination: dropping a panel anywhere on the session list places it on the
  // dock and the rail appears with its button. With the rail ON it accepts the
  // same drop too, because the session list beside the rail is still the left
  // column; the rail's own handlers own ordering, and a row stops the event.
  const { setSide } = useLeftDock();
  const { active: dropActive, dropProps } = usePanelDropTarget({
    onPlace: (id) => {
      setSide(id, 'left');
      // A panel dropped on the session list is the one this column should show;
      // otherwise the drop reads as "a new button appeared".
      onSelectView(id);
    },
    highlight: !railEnabled,
  });
  const updates = useUpdates();
  const { pushToast } = useToasts();
  const shellDownload = useShellOffer();

  /**
   * The tab strip's working set, and the catalog it opens views from.
   *
   * The LEFT column's sessions view is PINNED: it is why the column exists, so
   * it cannot be closed and it leads the strip. With the rail off there is no
   * strip at all (the plain session list), and the hook is simply unused.
   */
  const catalog = usePanelCatalog('left');
  const known = useMemo(() => new Set(catalog.map((panel) => panel.id)), [catalog]);
  const tabsState = usePanelTabs('left', known, SESSIONS_VIEW_ID);
  const tabsMode = railEnabled && navStyle === 'tabs';
  // The same reveal rule as the right column: the sidebar's expand toggle (and
  // `⌘B`) brings the column back, so it must bring a VIEW back rather than the
  // catalog the strip shows on a fresh session. The session list is pinned, so
  // this is the one column where the answer is always its own view.
  const revealed = useRevealEdge(open);
  useRevealPanelTab({
    enabled: tabsMode,
    revealed,
    view,
    home: tabsState.home,
    openTab: tabsState.open,
    known,
  });

  /**
   * A view opened from a card must reach the BODY, not only the strip, so the
   * active tab writes the same per-session selection the rail's button does.
   * One direction only: the reverse (`view` → tab) is derived on read, so a
   * stored selection that names a closed tab falls back instead of resurrecting
   * it.
   */
  useEffect(() => {
    if (!tabsMode) return;
    if (tabsState.active !== null && tabsState.active !== view) onSelectView(tabsState.active);
  }, [tabsMode, tabsState.active, view, onSelectView]);

  /**
   * The OTHER direction, for everything that is not the strip: `omp:open-panel`
   * from a plugin's navbar entry, a panel dropped on the column, a restored
   * stored selection. Those write `view` and do not know a strip exists, so the
   * tab would be missing from a column that is showing it — a chip strip whose
   * active view has no chip.
   */
  const { open: openTab, tabs: openTabIds } = tabsState;
  useEffect(() => {
    if (!tabsMode) return;
    if (openTabIds.includes(view)) return;
    // Only a view this column can DRAW becomes a tab. Writing an id the catalog
    // no longer holds — a panel switched off, a plugin mid-import — would be
    // filtered straight back out by `visiblePanelTabs` and re-opened on the next
    // render, which is a write loop disguised as a sync.
    if (!known.has(view)) return;
    openTab(view);
  }, [tabsMode, view, openTabIds, openTab, known]);

  // The update popup's "Update now" hands the run to the About modal, which owns
  // the live output. The column owns both, so a view switch cannot lose them.
  useKabmoEvent(UPDATE_REQUEST_EVENT, () => {
    setInfoOpen(true);
    void updates.apply('kabmo').then((result) => {
      if (!result) return;
      pushToast(result.message, updateOutcomeTone(result));
    });
  });

  // The native App menu's "Check for Updates…". The row cannot read this
  // column's state, so it asks for the check and this is the one place that
  // runs it — the popup when a release is available, a sentence when there is
  // not.
  useUpdateCheckRequest(updates, pushToast);

  return (
    <>
      <Panel
        panelRef={panelRef}
        id="left-panel"
        defaultSize={width}
        minSize={minWidth}
        maxSize={MAX_LEFT_PANEL_WIDTH}
        collapsed={!open}
      >
        {/* The column is three ROWS, and the order is what makes it read as one
            column: a title row across the whole width, then the rail beside the
            view, then the strip across the whole width again. The rail must not
            start above the title — it would run under the app's own titlebar —
            and the strip must not stop at the view's edge. */}
        <div
          className={`glass-chrome flex flex-col h-full w-full bg-paper ${
            dropActive ? 'ring-1 ring-inset ring-ink/30' : ''
          }`}
          {...dropProps}
        >
          <SessionSidebarHeader streamStatus={streamStatus} onCollapse={onCollapse} />
          <div className="flex flex-1 min-h-0 w-full">
            {railEnabled && navStyle === 'rail' ? (
              <ActivityBar
                side="left"
                activePanel={view}
                onChangePanel={onSelectView}
                isPanelOpen={open}
                hasActiveContext={hasActiveContext}
                activeProjectPath={activeProjectPath}
              />
            ) : null}
            {tabsMode ? (
              <PanelTabsColumn
                catalog={catalog}
                tabs={tabsState}
                pinned={SESSIONS_VIEW_ID}
                homeTitle="Panel kiri"
                actions={
                  <button
                    type="button"
                    onClick={onRefresh}
                    title="Muat ulang view"
                    aria-label="Muat ulang view"
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink"
                  >
                    <RefreshCw size={13} />
                  </button>
                }
              >
                <LeftDockView
                  className="w-full h-full"
                  // The strip's own selection, not the stored one it syncs into:
                  // reading `view` here would make the body lag the chip by one
                  // render, which is visible as a chip that looks selected over
                  // the previous view.
                  activeView={tabsState.active ?? view}
                  onClose={onCollapse}
                  appSettings={appSettings}
                  streamStatus={streamStatus}
                  refreshKey={refreshKey}
                  onRefresh={onRefresh}
                  onOpenFile={onOpenFile}
                  sessionId={sessionId ?? null}
                  {...(activeProjectPath ? { rootPath: activeProjectPath } : {})}
                  hasActiveContext={hasActiveContext}
                  tabsMode
                />
              </PanelTabsColumn>
            ) : (
              <LeftDockView
                className="flex-1 min-w-0 h-full"
                activeView={view}
                onClose={onCollapse}
                appSettings={appSettings}
                streamStatus={streamStatus}
                refreshKey={refreshKey}
                onRefresh={onRefresh}
                onOpenFile={onOpenFile}
                sessionId={sessionId ?? null}
                {...(activeProjectPath ? { rootPath: activeProjectPath } : {})}
                hasActiveContext={hasActiveContext}
              />
            )}
          </div>
          <SessionSidebarFooter
            onSettings={() => setSettingsOpen(true)}
            onKeyBindings={openKeyBindingHelp}
            onInfo={() => setInfoOpen(true)}
            onMobileToggle={onMobileToggle}
            shellDownload={shellDownload}
            updateAvailable={updates.hasUpdate}
            onUpdateClick={() => {
              setInfoOpen(true);
              void updates.check();
            }}
          />
        </div>
      </Panel>

      {open ? <ResizeHandle /> : null}

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} appSettings={appSettings} />
      <AboutModal isOpen={infoOpen} onClose={() => setInfoOpen(false)} updates={updates} onToast={pushToast} />
      <UpdatePopup updates={updates} />
    </>
  );
}
