import { useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent, TargetedMouseEvent } from 'preact';

import { useGitStatus } from '@/client/hooks/workspace/git-status';
import { useResolvedRepo } from '@/client/hooks/workspace/repo-scope';
import { usePanelCatalog, type ResolvedPanel } from '@/client/components/workspace/plugin-panel/resolve';
import { usePanelPluginActions, usePanelRegistry } from '@/client/hooks/workspace/panel-registry';
import { usePanelOrder } from '@/client/hooks/workspace/panel-order';
import { usePanelReorder } from '@/client/hooks/workspace/panel-reorder';
import { pluginPanelKey } from '@/shared/lib/workspace/panel-ids';
import { PANEL_MARK_SIZE } from '@/shared/lib/workspace/right-panels';
import { BUILTIN_PANELS } from '@/client/components/workspace/panels/builtin';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';
import { PanelVisibilityMenu, type PanelVisibilityItem } from '@/client/components/layout/PanelVisibilityMenu';

interface RightActivityBarProps {
  /** A built-in view id or a plugin panel key (`plugin:<pluginId>`). */
  activePanel: string;
  onChangePanel: (panel: string) => void;
  isPanelOpen: boolean;
  hasActiveContext: boolean;
  activeProjectPath?: string | null;
}

/**
 * The right developer panel's activity bar.
 *
 * ONE list of buttons: the built-in views and the installed plugins both come
 * from `usePanelCatalog`, so the bar cannot draw one kind from a table and the
 * other from a fetch — and the catalog is what the phone's tab strip and the
 * desktop panel stack read too, so the order here is the only order any of them
 * can draw.
 *
 * The buttons are DRAGGABLE, and a drop commits the whole order to
 * `app_settings.omp_right_panel_order` (`usePanelOrder` + `usePanelReorder`).
 * The reorder is previewed while the gesture runs and written ONCE at the end.
 *
 * Right-clicking the bar opens the enablement menu — VS Code's own affordance,
 * with its own semantics here: a view that is switched off leaves the bar but
 * stays in that menu with its checkbox off, which is the only place it can be
 * switched back on. EVERY view is switchable, built-in or plugin, because
 * enablement is one set of ids and a built-in view can be put away exactly like
 * an installed one. A switched-off view KEEPS its place in the stored order, so
 * switching it back on returns it where the user put it.
 *
 * A plugin contributes AT MOST ONE right panel, so one plugin can never produce
 * two buttons here.
 */
export function RightActivityBar({ activePanel, onChangePanel, isPanelOpen, hasActiveContext, activeProjectPath }: RightActivityBarProps) {
  // The dot is the Source Control view's, so it follows the repo that view is
  // on. Reading it through the shared pick (not through a private copy) is what
  // makes this update the moment the panel's picker moves; polling the workspace
  // root instead showed the wrong repository's changes.
  const activeRepo = useResolvedRepo(activeProjectPath ?? undefined, hasActiveContext);
  const { changes } = useGitStatus(activeProjectPath ?? undefined, activeRepo, hasActiveContext);
  const hasGitChanges = changes.length > 0;

  const catalog = usePanelCatalog();
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
  const drawn = reorder.order
    .map((id) => byId.get(id))
    .filter((panel): panel is ResolvedPanel => panel !== undefined);

  // The hairline that separates the chamber's own furniture from the installed
  // plugins, drawn only while that grouping still HOLDS. The default order puts
  // every built-in above every plugin and the divider says so; once the user
  // drags a plugin up among the built-ins there is no longer a boundary to
  // draw, and a line through the middle of the list would claim one.
  const firstPlugin = drawn.findIndex((panel) => !panel.builtin);
  const dividerBefore =
    firstPlugin > 0 && drawn.slice(firstPlugin).every((panel) => !panel.builtin) ? firstPlugin : -1;

  // The menu lists EVERY panel, off or on — a switched-off view must stay
  // reachable, and this list is the only place it can be switched back on. It
  // is built from the FULL id list rather than from the catalog, because a
  // switched-off view is not in the catalog at all. The entry is keyed by the
  // SAME id the disabled set stores, so the checkbox and the write cannot
  // address different panels.
  const allItems = useAllPanelItems();

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
        className="w-11 flex-shrink-0 border-l border-ink/10 bg-paper flex flex-col items-center py-3 space-y-2 z-10"
      >
        <div className="flex flex-col items-center space-y-1 w-full">
          {drawn.map((panel, index) => (
            <div key={panel.id} className="w-full">
              {index === dividerBefore ? <div className="w-6 mx-auto border-t border-ink/10 my-1" /> : null}
              <PanelButton
                panel={panel}
                isActive={isPanelOpen && activePanel === panel.id}
                isDragging={reorder.draggingId === panel.id}
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
 */
function useAllPanelItems(): PanelVisibilityItem[] {
  const { plugins } = usePanelRegistry();
  return [
    ...BUILTIN_PANELS.map((panel) => ({ id: panel.id, title: panel.title, removable: true })),
    ...plugins.map((plugin) => ({
      id: pluginPanelKey(plugin.pluginId),
      title: plugin.name,
      removable: true,
    })),
  ];
}

/**
 * One activity-bar button, drawn from the catalog entry it belongs to.
 *
 * It is both a drag SOURCE and a drop TARGET: the drop is what moves the
 * button, and `dragover` is the only moment a target can accept it.
 */
function PanelButton({
  panel,
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
      className={`relative w-full h-10 flex items-center justify-center transition-colors border-l-2 ${
        isActive ? 'text-ink border-ink bg-ink/5' : 'text-ink/40 border-transparent hover:text-ink hover:bg-ink/5'
      } ${isDragging ? 'opacity-40 cursor-grabbing' : 'cursor-pointer'}`}
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title={panel.title}
      aria-label={panel.title}
    >
      {panel.builtin ? panel.icon : <PluginMark name={panel.name} iconUrl={panel.iconUrl} size={PANEL_MARK_SIZE} />}
      {showGitDot ? (
        <span
          className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-info"
          title="Ada perubahan git"
        />
      ) : null}
    </button>
  );
}
