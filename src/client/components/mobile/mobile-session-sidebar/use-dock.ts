/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone drawer's LEFT dock state — the same three facts the desktop column
 * keeps, so the two cannot disagree about what the dock holds or what it shows.
 *
 * - the catalog is `usePanelCatalog('left')`, the dock's own list (`sessions`
 *   first, then the placed plugins in placement order);
 * - the selection is PERSISTED per session, like the right drawer's tab, because
 *   the drawer unmounts when it closes;
 * - a stored id naming a panel that has moved back to the right resolves to the
 *   session list, while one naming nothing at all is returned as-is so the body
 *   can say WHY rather than showing a blank column.
 *
 * Under the TAB style the drawer keeps a working set exactly as the desktop
 * column does, with the session list PINNED as the first chip: a drawer with no
 * way back to another chat is a dead end, which is the same reason
 * `LeftColumn` passes `SESSIONS_VIEW_ID` as `pinned`.
 */

import { useMemo } from 'preact/hooks';
import type { PanelBodyProps } from '@/client/components/workspace/panels/builtin';
import { usePanelCatalog, useLeftDockView } from '@/client/components/workspace/plugin-panel/catalog';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { useLeftDock } from '@/client/hooks/workspace/left-dock';
import { useSharedSessionState } from '@/client/hooks/workspace/session-state';
import { useMobilePanelNav } from '@/client/hooks/workspace/mobile-panel-nav';
import { usePanelTabs, type PanelTabsHandle } from '@/client/hooks/workspace/panel-tabs';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';

export interface MobileDockState {
  /** The strip's chips: `sessions` and every placed panel. */
  catalog: ResolvedPanel[];
  activeView: string;
  setActiveView: (id: string) => void;
  /** True while the session list is the view on screen. */
  showingSessions: boolean;
  activePanel: ResolvedPanel | undefined;
  /** Whether the rail is on at all. */
  enabled: boolean;
  /**
   * The drawer navigates by a working set rather than by the whole catalog.
   *
   * `false` under `classic`, and also with the rail off: there is no strip then,
   * so there is nothing to open a tab from and the drawer is the session list.
   */
  tabsMode: boolean;
  /** The working set, or `null` when this drawer is not in tabs mode. */
  tabs: PanelTabsHandle | null;
}

export function useMobileDock(): MobileDockState {
  const dock = useLeftDock();
  const catalog = usePanelCatalog('left');
  // SHARED, not private: the navbar's own readout can ask for this view, and
  // the write it makes is a different component's. A private copy would keep
  // the selection it read at mount and the drawer would open on the old view —
  // the same rule `useResolvedRepo` follows for a value a second surface moves.
  const [stored, setStored] = useSharedSessionState<string>('layout.mobileLeftPanel', SESSIONS_VIEW_ID);
  const activeView = useLeftDockView(stored, dock.enabled);
  const navStyle = useMobilePanelNav('left');
  // The desktop column's own rule (`LeftColumn`): a style is only a shape when
  // the rail is on. With the rail off there is no strip at all, so tabs mode
  // would have nothing to open a view from.
  const tabsMode = dock.enabled && navStyle === 'tabs';
  const known = useMemo(() => new Set(catalog.map((panel) => panel.id)), [catalog]);
  const tabs = usePanelTabs('left', known, SESSIONS_VIEW_ID);

  return {
    catalog,
    activeView,
    setActiveView: setStored,
    showingSessions: activeView === SESSIONS_VIEW_ID,
    activePanel: catalog.find((panel) => panel.id === activeView),
    enabled: dock.enabled,
    tabsMode,
    tabs: tabsMode ? tabs : null,
  };
}

/**
 * The props a placed panel's body receives.
 *
 * The drawer draws its own title row, so `showHeader` is false — a view's own
 * header would be a second one, the same rule the right drawer follows.
 */
export function dockBodyProps(input: {
  sessionId: number | string | null;
  refreshKey: number;
  rootPath?: string;
  onRefresh?: () => void;
  onOpenFile?: (file: unknown) => void;
  onClose: () => void;
  /** The view on screen, so a tree-reading built-in is inert without a folder. */
  requiresWorkspace?: boolean;
  hasActiveContext?: boolean;
}): PanelBodyProps {
  return {
    className: 'w-full h-full',
    sessionId: input.sessionId === null ? null : String(input.sessionId),
    enabled: input.requiresWorkspace ? input.hasActiveContext === true : true,
    active: true,
    refreshKey: input.refreshKey,
    ...(input.rootPath ? { rootPath: input.rootPath } : {}),
    ...(input.onRefresh ? { onRefresh: input.onRefresh } : {}),
    ...(input.onOpenFile ? { onOpenFile: input.onOpenFile } : {}),
    onClose: input.onClose,
    showHeader: false,
    layout: 'phone',
  };
}
