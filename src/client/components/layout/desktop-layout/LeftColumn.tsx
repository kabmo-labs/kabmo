/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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

import { useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { Panel, type PanelImperativeHandle } from '@/client/components/layout/desktop-layout/resizer';
import { ActivityBar } from '@/client/components/layout/ActivityBar';
import { LeftDockView } from '@/client/components/layout/LeftDock';
import { ResizeHandle } from '@/client/components/layout/desktop-layout/ResizeHandle';
import { AboutModal } from '@/client/components/layout/session-sidebar/about-modal';
import { UpdatePopup } from '@/client/components/layout/update-popup';
import { SettingsModal } from '@/client/components/settings/LazyModal';
import { SessionSidebarFooter } from '@/client/components/layout/session-sidebar/Footer';
import { SessionSidebarHeader } from '@/client/components/layout/session-sidebar/Header';
import { ToastStack } from '@/client/components/common/ToastStack';
import { useShellOffer } from '@/client/hooks/ui/updates/shell-download';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useUpdates } from '@/client/hooks/ui/updates';
import { UPDATE_REQUEST_EVENT } from '@/shared/lib/updates/popup-state';
import { MAX_LEFT_PANEL_WIDTH } from '@/shared/lib/workspace/sidebar-width';
import type { AgentStreamStatus } from '@/shared/lib/chat/omp/status';

interface LeftColumnProps {
  panelRef: RefObject<PanelImperativeHandle | null>;
  open: boolean;
  /** Draw the rail. A global preference, off by default. */
  railEnabled: boolean;
  /** The view the dock actually shows, after resolving the stored selection. */
  view: string;
  onSelectView: (view: string) => void;
  onCollapse: () => void;
  width: number;
  minWidth: number;
  hasActiveContext: boolean;
  activeProjectPath?: string | null;
  appSettings?: Record<string, any>;
  streamStatus?: AgentStreamStatus;
  refreshKey: number;
  onRefresh: () => void;
  onOpenFile: (file: unknown) => void;
}

export function LeftColumn({
  panelRef,
  open,
  railEnabled,
  view,
  onSelectView,
  onCollapse,
  width,
  minWidth,
  hasActiveContext,
  activeProjectPath,
  appSettings = {},
  streamStatus,
  refreshKey,
  onRefresh,
  onOpenFile,
}: LeftColumnProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const updates = useUpdates();
  const { toasts, pushToast, dismissToast } = useToasts();
  const shellDownload = useShellOffer();

  // The update popup's "Update now" hands the run to the About modal, which owns
  // the live output. The column owns both, so a view switch cannot lose them.
  useKabmoEvent(UPDATE_REQUEST_EVENT, () => {
    setInfoOpen(true);
    void updates.apply('kabmo').then((result) => {
      if (!result) return;
      pushToast(result.message, result.success && !result.manual ? 'success' : 'error');
    });
  });

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
        <div className="flex flex-col h-full w-full bg-paper">
          <SessionSidebarHeader streamStatus={streamStatus} onCollapse={onCollapse} />
          <div className="flex flex-1 min-h-0 w-full">
            {railEnabled ? (
              <ActivityBar
                side="left"
                activePanel={view}
                onChangePanel={onSelectView}
                isPanelOpen={open}
                hasActiveContext={hasActiveContext}
                activeProjectPath={activeProjectPath}
              />
            ) : null}
            <LeftDockView
              className="flex-1 min-w-0 h-full"
              activeView={view}
              onClose={onCollapse}
              appSettings={appSettings}
              refreshKey={refreshKey}
              onRefresh={onRefresh}
              onOpenFile={onOpenFile}
            />
          </div>
          <SessionSidebarFooter
            onSettings={() => setSettingsOpen(true)}
            onInfo={() => setInfoOpen(true)}
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
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
