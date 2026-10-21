/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
 * - the ORDER, which the right column stores in `omp_right_panel_order`; the
 *   left column is ordered by its placement list, so it is drawn as the catalog
 *   returns it and a drag is not offered there;
 * - the DOT, which belongs to Source Control and therefore to the right rail.
 */

import { useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent, TargetedMouseEvent } from 'preact';
import { useGitStatus } from '@/client/hooks/workspace/git-status';
import { useResolvedRepo } from '@/client/hooks/workspace/repo-scope';
import {
  usePanelCatalog,
  type PanelCatalogSide,
  type ResolvedPanel,
} from '@/client/components/workspace/plugin-panel/catalog';
import { usePanelPluginActions, usePanelRegistry } from '@/client/hooks/workspace/panel-registry';
import { usePanelOrder } from '@/client/hooks/workspace/panel-order';
import { usePanelReorder } from '@/client/hooks/workspace/panel-reorder';
import { pluginPanelKey } from '@/shared/lib/workspace/panel-ids';
import { PANEL_MARK_SIZE } from '@/shared/lib/workspace/right-panels';
import { SESSIONS_VIEW_ID, isLeftDockPanelId } from '@/shared/lib/workspace/left-dock';
import { BUILTIN_PANELS } from '@/client/components/workspace/panels/builtin';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';
import { PanelVisibilityMenu, type PanelVisibilityItem } from '@/client/components/layout/PanelVisibilityMenu';

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
 * The left rail is the DOCK's, so its ordering is the placement list and a drag
 * would have nothing to commit — `draggable` is false there and the reorder hook
 * is never given a commit. Everything else is shared.
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
  const reorderable = side !== 'left';
  const { commitReorder } = usePanelOrder();
  const { disabledPanels } = usePanelRegistry();
  const { setEnabled } = usePanelPluginActions();
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);

  const catalogIds = catalog.map((panel) => panel.id);
  const reorder = usePanelReorder(catalogIds, commitReorder);

  // What the bar draws: the catalog in the order being dragged, which is the
  // stored order until a drag starts. An id in the order that the catalog no
  // longer holds (a panel switched off, a plugin removed) has no entry and is
  // simply not drawn — the id stays in the stored order, so switching the panel
  // back on returns it where it was.
  const byId = new Map(catalog.map((panel) => [panel.id, panel]));
  const order = reorderable ? reorder.order : catalogIds;
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

  return (
    <>
      <nav
        ref={navRef}
        onContextMenu={openMenu}
        aria-label={side === 'left' ? 'Left panel views' : 'Right panel views'}
        className={`w-11 flex-shrink-0 ${side === 'left' ? 'border-r' : 'border-l'} border-ink/10 bg-paper flex flex-col items-center py-3 space-y-2 z-10`}
      >
        <div className="flex flex-col items-center space-y-1 w-full">
          {drawn.map((panel, index) => (
            <div key={panel.id} className="w-full">
              {index === dividerBefore ? <div className="w-6 mx-auto border-t border-ink/10 my-1" /> : null}
              <PanelButton
                panel={panel}
                draggable={reorderable}
                isActive={isPanelOpen && activePanel === panel.id}
                isDragging={reorderable && reorder.draggingId === panel.id}
                onClick={() => onChangePanel(panel.id)}
                onDragStart={(event) => reorder.onDragStart(event, panel.id)}
                onDragOver={(event) => reorder.onDragOver(event, panel.id)}
                onDrop={reorder.onDrop}
                onDragEnd={reorder.onDragEnd}
                showGitDot={panel.id === 'git' && hasGitChanges}
              />
            </div>
          ))}
        </div>

        <div className="flex-1" />
      </nav>

      {anchor ? (
        <PanelVisibilityMenu
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

/**
 * Every panel the menu can offer, including the ones switched off.
 *
 * A switched-off panel is NOT in the catalog (the catalog is what the bar
 * draws), so reading the menu off the catalog alone would make a hidden view
 * unreachable — the one thing the menu exists to prevent. The built-ins are a
 * static list, so they are always listed; a plugin is listed while it is
 * INSTALLED, read from `plugins` rather than from `panels`, because `panels`
 * holds only the enabled ones and a disabled plugin would lose its row.
 *
 * The list is per SIDE: the left rail offering eleven built-in views it cannot
 * draw would be a menu of controls that do nothing.
 */
function useAllPanelItems(side: PanelCatalogSide): PanelVisibilityItem[] {
  const { plugins } = usePanelRegistry();
  const items: PanelVisibilityItem[] = [];
  if (side !== 'right') {
    // The session list is the dock's own view and cannot be switched off: it is
    // the only way back to a conversation.
    items.push({ id: SESSIONS_VIEW_ID, title: 'Sessions', removable: false });
  }
  if (side !== 'left') {
    for (const panel of BUILTIN_PANELS) items.push({ id: panel.id, title: panel.title, removable: true });
  }
  for (const plugin of plugins) {
    const id = pluginPanelKey(plugin.pluginId);
    // A plugin is offered on both rails: its placement decides which one draws
    // it, and the switch is the same switch on either.
    if (side === 'left' && !isLeftDockPanelId(id)) continue;
    items.push({ id, title: plugin.name, removable: true });
  }
  return items;
}

/**
 * One activity-bar button, drawn from the catalog entry it belongs to.
 *
 * It is both a drag SOURCE and a drop TARGET: the drop is what moves the
 * button, and `dragover` is the only moment a target can accept it.
 */
function PanelButton({
  panel,
  draggable,
  isActive,
  isDragging,
  onClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  showGitDot,
}: {
  panel: ResolvedPanel;
  draggable: boolean;
  isActive: boolean;
  isDragging: boolean;
  onClick: () => void;
  onDragStart: (event: TargetedDragEvent<HTMLElement>) => void;
  onDragOver: (event: TargetedDragEvent<HTMLElement>) => void;
  onDrop: (event: TargetedDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  showGitDot: boolean;
}) {
  return (
    <button
      className={`relative w-full h-10 flex items-center justify-center transition-colors ${
        panel.side === 'left' ? 'border-r-2' : 'border-l-2'
      } ${
        isActive ? 'text-ink border-ink bg-ink/5' : 'text-ink/40 border-transparent hover:text-ink hover:bg-ink/5'
      } ${isDragging ? 'opacity-40 cursor-grabbing' : 'cursor-pointer'}`}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title={panel.title}
      aria-label={panel.title}
    >
      {panel.builtin && panel.icon ? panel.icon : panel.builtin ? <PluginMark name={panel.label} size={PANEL_MARK_SIZE} /> : <PluginMark name={panel.name} iconUrl={panel.iconUrl} size={PANEL_MARK_SIZE} />}
      {showGitDot ? (
        <span
          className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-info"
          title="Ada perubahan git"
        />
      ) : null}
    </button>
  );
}
