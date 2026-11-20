/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the right column draws, and the drop target that decides where a panel
 * dropped on it lands.
 *
 * Extracted from `WorkspacePanels` for the repository's per-file ceiling, and
 * it earns the boundary: the column's content is ONE renderer for two kinds of
 * view plus its own drop rule, while the panels around it own widths, the chat
 * and the editor.
 */

import type { RefObject } from 'preact';
import type { PanelImperativeHandle } from '@/client/components/layout/desktop-layout/resizer';
import { Panel } from '@/client/components/layout/desktop-layout/resizer';
import { PanelSuspense } from '@/client/components/layout/desktop-layout/PanelSuspense';
import { PluginPanelBody } from '@/client/components/workspace/plugin-panel/resolve';
import { PanelHostProvider } from '@kabmo-labs/kabmo-ui';
import type { PanelBodyProps } from '@/client/components/workspace/plugin-panel/resolve';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { usePanelDropTarget } from '@/client/hooks/workspace/panel-drop-target';
import { useLeftDock } from '@/client/hooks/workspace/left-dock';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';

export interface RightColumnProps {
  panelRef: RefObject<PanelImperativeHandle | null>;
  open: boolean;
  width: number;
  minWidth: number;
  maxWidth: number | undefined;
  /** The catalog, in rail order: built-in views and installed plugin panels. */
  catalog: ResolvedPanel[];
  /** The view actually drawn — the stored id, or the column's first view. */
  shownPanel: string;
  /** The stored selection, which may name a panel this build cannot draw. */
  selectedPanel: string;
  activePanelFound: boolean;
  hasActiveContext: boolean;
  activeProjectPath?: string | null;
  refreshKey: number;
  onRefresh: () => void;
  /** A view's "open this file" hand-off; the host's own opener owns the path. */
  onOpenFile: (file: unknown) => void;
  onClose: () => void;
}

export function RightColumn({
  panelRef,
  open,
  width,
  minWidth,
  maxWidth,
  catalog,
  shownPanel,
  selectedPanel,
  activePanelFound,
  hasActiveContext,
  activeProjectPath,
  refreshKey,
  onRefresh,
  onOpenFile,
  onClose,
}: RightColumnProps) {
  // The right column is a destination too: a panel dragged from the left rail
  // must land where it was dropped, not bounce back because only the 44px rail
  // accepted it. The rail owns ordering; this owns which side receives it.
  const { setSide } = useLeftDock();
  const rightDrop = usePanelDropTarget({ onPlace: (id) => setSide(id, 'right') });
  const { sessionId } = useSessionStateContext();

  return (
    <Panel panelRef={panelRef} id="right-panel" defaultSize={width} minSize={minWidth} maxSize={maxWidth} collapsed={!open}>
      <div
        className={`w-full h-full ${rightDrop.active ? 'ring-1 ring-inset ring-ink/30' : ''}`}
        {...rightDrop.dropProps}
      >
        <PanelSuspense>
          {/* ONE renderer for both kinds of panel. Each view stays MOUNTED
              while another is on screen (hidden with CSS), so a tree's
              expansion, a search's results and a terminal's buffer survive a
              switch. A plugin panel is mounted only while it is the active
              one: a hidden plugin is a component nobody is looking at, and
              the host owns no state of its own to preserve. */}
          {catalog.map((panel) => {
            const isActiveView = shownPanel === panel.id;
            if (!panel.builtin && !isActiveView) return null;
            const body: PanelBodyProps = {
              className: 'w-full h-full',
              sessionId,
              // A view that stays live while hidden keeps reading even when
              // another view is on screen — the terminal owns a live PTY and
              // swapping it to the placeholder mid-command would drop the
              // stream. Everything else polls only while shown.
              enabled: panel.liveWhileHidden ? hasActiveContext : hasActiveContext && isActiveView,
              // On screen means selected AND the column is open. A collapsed
              // right panel keeps every view MOUNTED (that is what preserves a
              // tree's expansion and a terminal's buffer), so `isActiveView`
              // alone would report a view nobody can see as active — and a
              // view that re-reads on activation would never notice the
              // column being reopened.
              active: isActiveView && open,
              refreshKey,
              ...(activeProjectPath ? { rootPath: activeProjectPath } : {}),
              onRefresh,
              onOpenFile,
              onClose,
              layout: 'desktop',
            };
            // `glass-chrome` + `data-panel-chrome` on the SLOT, not on each
            // view: the right panel is column chrome, exactly like the session
            // sidebar, and ten built-in views plus every plugin panel paint
            // their own `bg-paper` root. Marking the slot makes the column one
            // surface and leaves a future view nothing to forget.
            return (
              <div
                key={panel.id}
                data-panel-chrome=""
                className={`glass-chrome w-full h-full${isActiveView ? '' : ' hidden'}`}
              >
                <PanelHostProvider value={body}>{panel.render(body)}</PanelHostProvider>
              </div>
            );
          })}
          {/* The selection names a panel that is switched off, uninstalled, or
              whose bundle has not loaded — a notice, never a blank column. */}
          {activePanelFound ? null : (
            <div data-panel-chrome="" className="glass-chrome w-full h-full">
              <PluginPanelBody panelKey={selectedPanel} />
            </div>
          )}
        </PanelSuspense>
      </div>
    </Panel>
  );
}
