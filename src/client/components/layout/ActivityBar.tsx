/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * An activity bar: the rail of panel buttons, for one column.
 *
 * ONE component for both sides. The two rails list different catalogs and sit
 * on opposite edges, but everything that made the right rail work — a drag that
 * commits the order once, a right-click menu that keeps a switched-off view
 * reachable, the Source Control dot — is the same problem on the left. Writing
 * it twice is how the two headers drifted, and a user switching layouts had to
 * re-find every control.
 *
 * What is per-side is data, not branches:
 *
 * - the CATALOG (`usePanelCatalog(side)`), so the left rail draws the session
 *   list plus whatever the user placed there;
 * - the ORDER, which the right column stores in `omp_right_panel_order` and the
 *   left column in its placement list (`omp_left_panels`). Both rails drag, and
 *   the COMMIT goes to the store that owns the order — never to a shared list
 *   with a per-side branch in it;
 * - the DOT, which belongs to Source Control and therefore to the right rail.
 *
 * A drag BETWEEN rails is still one gesture: the payload carries the panel id
 * (`PANEL_DRAG_MIME`), and a rail that receives a panel it does not draw asks
 * the placement store to move it here. Dropping a panel on its own rail's
 * background moves it to the end; dropping it on another row reorders it.
 */

import { useCallback, useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent, TargetedMouseEvent } from 'preact';
import { useGitStatus } from '@/client/hooks/workspace/git-status';
import { useResolvedRepo } from '@/client/hooks/workspace/repo-scope';
import {
  usePanelCatalog,
  type PanelCatalogSide,
  type ResolvedPanel,
} from '@/client/components/workspace/plugin-panel/catalog';
import { PanelButton } from '@/client/components/layout/PanelButton';
import { usePanelPluginActions, usePanelRegistry } from '@/client/hooks/workspace/panel-registry';
import { usePanelOrder } from '@/client/hooks/workspace/panel-order';
import { usePanelReorder } from '@/client/hooks/workspace/panel-reorder';
import { useLeftDock } from '@/client/hooks/workspace/left-dock';
import { useAllPanelItems } from '@/client/hooks/workspace/panel-menu-items';
import { carriesPanelDrag, droppedPanelId } from '@/shared/lib/workspace/panel-drag';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';
import { VisibilityMenu } from '@/client/components/layout/VisibilityMenu';
import { ACTIVITY_BAR_WIDTH_PX } from '@/client/lib/ui/control-plate';

interface ActivityBarProps {
  side: PanelCatalogSide;
  /** A built-in view id, `sessions`, or a plugin panel key (`plugin:<pluginId>`). */
  activePanel: string;
  onChangePanel: (panel: string) => void;
  isPanelOpen: boolean;
  hasActiveContext: boolean;
  activeProjectPath?: string | null;
}

/**
 * One column's rail.
 *
 * Both rails reorder by dragging a button onto another. What differs is the
 * commit: the right column writes the global panel order, the left column writes
 * its placement list (`setOrder`), which IS its order. The session list is the
 * one button that is neither draggable nor a reorder target — it is the dock's
 * pinned view.
 */
export function ActivityBar({ side, activePanel, onChangePanel, isPanelOpen, hasActiveContext, activeProjectPath }: ActivityBarProps) {
  // The dot is the Source Control view's, so it follows the repo that view is
  // on. Reading it through the shared pick (not through a private copy) is what
  // makes this update the moment the panel's picker moves; polling the workspace
  // root instead showed the wrong repository's changes. The left rail has no
  // Source Control, so it does not poll at all.
  const wantsGitDot = side !== 'left';
  const activeRepo = useResolvedRepo(activeProjectPath ?? undefined, wantsGitDot && hasActiveContext);
  const { changes } = useGitStatus(activeProjectPath ?? undefined, activeRepo, wantsGitDot && hasActiveContext);
  const hasGitChanges = changes.length > 0;

  const catalog = usePanelCatalog(side);
  // Both rails are drag surfaces now: a panel is reordered inside its own rail
  // and MOVED to the other one by dropping it there. `all` is not a rail, so it
  // offers no handlers.
  const railSide = side === 'left' || side === 'right' ? side : null;
  const reorderable = railSide !== null;
  const { commitReorder } = usePanelOrder();
  const { setSide, setOrder } = useLeftDock();
  const { disabledPanels } = usePanelRegistry();
  const { setEnabled } = usePanelPluginActions();
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  const catalogIds = catalog.map((panel) => panel.id);
  // The session list is the dock's PINNED view: it never moves and never takes
  // part in a reorder. Everything else the rail draws is draggable, built-in
  // and plugin alike.
  const reorderIds = side === 'left' ? catalogIds.filter((id) => id !== SESSIONS_VIEW_ID) : catalogIds;
  // One commit for both rails, because the destination decides which store owns
  // the order: the dock's placement list on the left, the global panel order on
  // the right.
  const commitOrder = useCallback(
    (visibleIds: readonly string[], nextVisible: readonly string[]) => {
      if (side === 'left') setOrder(nextVisible);
      else commitReorder(visibleIds, nextVisible);
    },
    [side, setOrder, commitReorder],
  );
  const reorder = usePanelReorder(reorderIds, commitOrder);

  // What the bar draws: the catalog in the order being dragged, which is the
  // stored order until a drag starts. An id in the order that the catalog no
  // longer holds (a panel switched off, a plugin removed) has no entry and is
  // simply not drawn — the id stays in the stored order, so switching the panel
  // back on returns it where it was.
  const byId = new Map(catalog.map((panel) => [panel.id, panel]));
  const orderedIds = reorderable ? reorder.order : catalogIds;
  // The pinned view stays first and outside the drag set, on every frame.
  const order = side === 'left' ? [SESSIONS_VIEW_ID, ...orderedIds] : orderedIds;
  const drawn = order
    .map((id) => byId.get(id))
    .filter((panel): panel is ResolvedPanel => panel !== undefined);

  // The hairline that separates Kabmo's own furniture from the installed
  // plugins, drawn only while that grouping still HOLDS. The default order puts
  // every built-in above every plugin and the divider says so; once the user
  // drags a plugin up among the built-ins there is no longer a boundary to
  // draw, and a line through the middle of the list would claim one.
  const firstPlugin = drawn.findIndex((panel) => !panel.builtin);
  const dividerBefore =
    firstPlugin > 0 && drawn.slice(firstPlugin).every((panel) => !panel.builtin) ? firstPlugin : -1;

  // The menu lists EVERY panel this rail could draw, off or on — a switched-off
  // view must stay reachable, and this list is the only place it can be switched
  // back on. It is built from the FULL id list rather than from the catalog,
  // because a switched-off view is not in the catalog at all. The entry is keyed
  // by the SAME id the disabled set stores, so the checkbox and the write cannot
  // address different panels.
  const allItems = useAllPanelItems(side);

  const openMenu = (event: TargetedMouseEvent<HTMLElement>) => {
    event.preventDefault();
    const rect = navRef.current?.getBoundingClientRect();
    setAnchor({
      top: rect?.top ?? 0,
      bottom: rect?.bottom ?? 0,
      left: rect?.left ?? event.clientX,
      right: rect?.right ?? event.clientX,
    });
  };

  /**
   * A file or a URL dropped on a rail is not ours, so the rail never claims it
   * and never paints a drop state for it.
   */
  const handleRailDragOver = (event: TargetedDragEvent<HTMLElement>) => {
    if (!carriesPanelDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (!dropActive) setDropActive(true);
  };

  const handleRailDragLeave = (event: TargetedDragEvent<HTMLElement>) => {
    if (navRef.current?.contains(event.relatedTarget as Node)) return;
    setDropActive(false);
  };

  /**
   * A drop on the rail's own background moves the panel to the END of this
   * rail. A row drop is handled by the row itself and stops propagation, so it
   * never reaches here.
   */
  const handleRailDrop = (event: TargetedDragEvent<HTMLElement>) => {
    if (!carriesPanelDrag(event.dataTransfer?.types)) return;
    event.preventDefault();
    setDropActive(false);
    const id = droppedPanelId(event.dataTransfer);
    if (!id || !railSide) return;
    if (!reorderIds.includes(id)) {
      // From the OTHER rail: the placement store owns the move and turns the
      // dock's rail on when that is where it landed. On the left the panel is
      // also SELECTED, because a panel dropped on that rail should be the one
      // it shows rather than a new button beside the old view.
      setSide(id, railSide);
      // The left rail's handler is a plain SELECT; the right rail's is a
      // TOGGLE (it collapses the active view), so a panel moved back to the
      // right must not be selected through it — the stored selection can still
      // name this panel from before the move, and the click semantics would
      // collapse the column instead of showing it.
      if (railSide === 'left') onChangePanel(id);
      return;
    }
    if (reorderIds[reorderIds.length - 1] === id) return;
    commitOrder(reorderIds, [...reorderIds.filter((other) => other !== id), id]);
  };

  const handleRowDragOver = (event: TargetedDragEvent<HTMLElement>, targetId: string) => {
    if (!carriesPanelDrag(event.dataTransfer?.types)) return;
    // The hook first, because its ref — not the rendered state — is the truth
    // for a drag that started in this bar. A `dragover` can arrive before the
    // `dragstart` state has re-rendered, and reading `draggingId` here would
    // classify our own drag as a foreign one and drop the reorder.
    reorder.onDragOver(event, targetId);
    if (!event.defaultPrevented) {
      // A panel from the other rail: this row IS a drop target even though the
      // reorder hook has no drag state for it.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }
  };

  const handleRowDrop = (event: TargetedDragEvent<HTMLElement>) => {
    // Always stop here: the rail's own drop would otherwise append the panel
    // the row just reordered (or a panel dropped on itself).
    event.stopPropagation();
    const id = droppedPanelId(event.dataTransfer);
    if (!id) return;
    if (!reorderIds.includes(id) && railSide) {
      event.preventDefault();
      setSide(id, railSide);
      if (railSide === 'left') onChangePanel(id);
      setDropActive(false);
      return;
    }
    reorder.onDrop(event);
  };

  return (
    <>
      <nav
        ref={navRef}
        onContextMenu={openMenu}
        onDragOver={handleRailDragOver}
        onDragLeave={handleRailDragLeave}
        onDrop={handleRailDrop}
        aria-label={side === 'left' ? 'Left panel views' : 'Right panel views'}
        className={`glass-chrome flex-shrink-0 ${side === 'left' ? 'border-r' : 'border-l'} border-ink/10 bg-paper flex flex-col items-center pb-3 space-y-2 z-10 ${
          dropActive ? 'ring-1 ring-inset ring-ink/40 bg-ink/5' : ''
        }`}
        style={{ width: ACTIVITY_BAR_WIDTH_PX }}
      >
        <div className="flex flex-col items-center space-y-1 w-full">
          {drawn.map((panel, index) => (
            <div key={panel.id} className="w-full">
              {index === dividerBefore ? <div className="w-6 mx-auto border-t border-ink/10 my-1" /> : null}
              <PanelButton
                panel={panel}
                draggable={reorderable && panel.id !== SESSIONS_VIEW_ID}
                isActive={isPanelOpen && activePanel === panel.id}
                isDragging={reorderable && reorder.draggingId === panel.id}
                onClick={() => onChangePanel(panel.id)}
                onDragStart={(event) => reorder.onDragStart(event, panel.id)}
                onDragOver={(event) => handleRowDragOver(event, panel.id)}
                onDrop={(event) => handleRowDrop(event)}
                onDragEnd={() => {
                  setDropActive(false);
                  reorder.onDragEnd();
                }}
                showGitDot={panel.id === 'git' && hasGitChanges}
              />
            </div>
          ))}
        </div>

        <div className="flex-1" />
      </nav>

      {anchor ? (
        <VisibilityMenu
          anchor={anchor}
          items={allItems}
          hidden={disabledPanels}
          onToggle={(id, visible) => void setEnabled(id, visible)}
          onClose={() => setAnchor(null)}
        />
      ) : null}
    </>
  );
}

