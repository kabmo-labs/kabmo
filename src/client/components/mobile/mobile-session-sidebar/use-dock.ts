/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone drawer's LEFT dock state.
 *
 * The desktop's left column is a dock — the session list plus whatever plugin
 * panel the user placed beside it, switched by a vertical rail. A phone has no
 * room for a rail, so the same catalog is switched by the chip strip the right
 * drawer uses, and everything that decides WHICH view is on screen lives here:
 *
 * - the catalog is `usePanelCatalog('left')`, the dock's own list (`sessions`
 *   first, then the placed plugins in placement order), so this drawer and the
 *   desktop column cannot disagree about what lives here;
 * - the selection is PERSISTED per session, like the right drawer's tab, because
 *   the drawer unmounts when it closes;
 * - a stored id naming a panel that has moved back to the right resolves to the
 *   session list, while one naming nothing at all is returned as-is so the body
 *   can say WHY rather than showing a blank column.
 */

import type { PanelBodyProps } from '@/client/components/workspace/panels/builtin';
import { usePanelCatalog, useLeftDockView } from '@/client/components/workspace/plugin-panel/catalog';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { useLeftDock } from '@/client/hooks/workspace/left-dock';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';

export interface MobileDockState {
  /** The strip's chips: `sessions` and every placed panel. */
  catalog: ResolvedPanel[];
  /** The placed panels only — what makes the strip worth drawing. */
  placed: ResolvedPanel[];
  activeView: string;
  setActiveView: (id: string) => void;
  /** True while the session list is the view on screen. */
  showingSessions: boolean;
  activePanel: ResolvedPanel | undefined;
  /** Whether the rail is on at all. */
  enabled: boolean;
}

export function useMobileDock(): MobileDockState {
  const dock = useLeftDock();
  const catalog = usePanelCatalog('left');
  const [stored, setStored] = useSessionState<string>('layout.mobileLeftPanel', SESSIONS_VIEW_ID);
  const activeView = useLeftDockView(stored, dock.enabled);
  const placed = catalog.filter((panel) => panel.id !== SESSIONS_VIEW_ID);

  return {
    catalog,
    placed,
    activeView,
    setActiveView: setStored,
    showingSessions: activeView === SESSIONS_VIEW_ID,
    activePanel: catalog.find((panel) => panel.id === activeView),
    enabled: dock.enabled,
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
}): PanelBodyProps {
  return {
    className: 'w-full h-full',
    sessionId: input.sessionId === null ? null : String(input.sessionId),
    enabled: true,
    active: true,
    refreshKey: input.refreshKey,
    ...(input.rootPath ? { rootPath: input.rootPath } : {}),
    ...(input.onRefresh ? { onRefresh: input.onRefresh } : {}),
    ...(input.onOpenFile ? { onOpenFile: input.onOpenFile } : {}),
    onClose: input.onClose,
    showHeader: false,
  };
}
