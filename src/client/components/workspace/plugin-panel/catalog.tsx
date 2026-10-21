/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel catalog: one list, two columns.
 *
 * The built-in views and the installed plugins travel the SAME path — one
 * merged list, one enablement set, one entry shape — so the activity bars, the
 * desktop panel stacks and the phone's tab strip cannot disagree about what
 * exists or what it is called.
 *
 * Two axes are decided here and nowhere else:
 *
 * - **SIDE.** A built-in view is `right` by construction; a plugin panel is
 *   `left` only while the user placed it there (`left-dock.ts`). A caller asks
 *   for the column it draws (`usePanelCatalog('left')`), or for everything
 *   (`usePanelCatalog('all')`, which is what the phone's drawer reads — a panel
 *   placed on the left must stay reachable on a phone, which has one drawer).
 * - **ORDER.** The right column keeps the user's dragged order
 *   (`omp_right_panel_order`); the left column is ordered by the placement list
 *   itself, because placing a panel there IS the arrangement.
 *
 * The left column also carries a view of its own — `sessions`, the session list
 * that used to BE the column. It is a catalog entry like any other so the bar
 * draws it with the same button, the same active state and the same visibility
 * menu; it is never removable, because a chat with no way back to the session
 * list is a dead end.
 */

import { lazy } from 'preact/compat';
import type { ReactNode } from 'preact/compat';
import { MessagesSquare } from 'lucide-preact';
import { useMemo } from 'preact/hooks';
import { usePanelRegistry, usePanelSlots } from '@/client/hooks/workspace/panel-registry';
import { usePanelOrder } from '@/client/hooks/workspace/panel-order';
import { useLeftDock } from '@/client/hooks/workspace/left-dock';
import { PluginIdProvider } from '@kabmo-labs/kabmo-ui';
import { rightPanelOf } from '@/client/lib/plugins/slots';
import { pluginPanelKey } from '@/shared/lib/workspace/panel-ids';
import { SESSIONS_VIEW_ID, panelSideOf, type PanelSide } from '@/shared/lib/workspace/left-dock';
import { resolvePluginPanelWidths } from '@/shared/lib/workspace/panel-widths';
import { DEFAULT_LEFT_PANEL_WIDTH, MIN_LEFT_PANEL_WIDTH } from '@/shared/lib/workspace/sidebar-width';
import {
  enabledBuiltinPanels,
  type BuiltinPanelView,
  type PanelBodyProps,
} from '@/client/components/workspace/panels/builtin';

/** `left`, `right`, or both — `all` is the phone's drawer and the settings pane. */
export type PanelCatalogSide = PanelSide | 'all';

/** One panel in the merged catalog — a built-in view, the dock's view, or a plugin. */
export interface ResolvedPanel {
  /** The panel id: a bare built-in view id, `sessions`, or `plugin:<pluginId>`. */
  id: string;
  /** The column it is drawn in. */
  side: PanelSide;
  /** The activity bar's tooltip. */
  title: string;
  /** The phone's chip label. */
  label: string;
  /** A built-in view's own icon; a plugin draws its mark instead. */
  icon?: ReactNode;
  /** A plugin's icon URL, when its manifest declares one. */
  iconUrl?: string;
  /** The plugin's display name; empty for a built-in view. */
  name: string;
  builtin: boolean;
  requiresWorkspace: boolean;
  liveWhileHidden: boolean;
  minWidth: number;
  /** The px width the view opens at before the group's area is measured. */
  defaultWidth: number;
  defaultFraction: number;
  /** Render the body. One call, so every layout draws a view the same way. */
  render: (props: PanelBodyProps) => ReactNode;
}

const SessionsView = lazy(() =>
  import('@/client/components/layout/session-sidebar/SessionsView').then((m) => ({ default: m.SessionsView })),
);

/** The dock's own view. Never removable, never placed anywhere else. */
const SESSIONS_PANEL: ResolvedPanel = {
  id: SESSIONS_VIEW_ID,
  side: 'left',
  title: 'Sessions',
  label: 'Sessions',
  icon: <MessagesSquare size={16} />,
  name: '',
  builtin: true,
  // The list is the workspace's own navigation: it reads folders and sessions,
  // not the working tree of the active folder.
  requiresWorkspace: false,
  liveWhileHidden: false,
  minWidth: MIN_LEFT_PANEL_WIDTH,
  defaultWidth: DEFAULT_LEFT_PANEL_WIDTH,
  // The left column is px-sized (a session list does not get more useful on a
  // wider monitor), so the fraction is only what a phone's drawer would use.
  defaultFraction: 0.25,
  // The column's title row and footer are NOT this view's: `LeftColumn` draws
  // them, so the rail and the list sit under ONE title and above ONE strip.
  render: (props) => <SessionsView className={props.className} appSettings={props.appSettings} />,
};

/** A built-in view's catalog entry, with its renderer closed over its component. */
function builtinEntry(view: BuiltinPanelView): ResolvedPanel {
  const View = view.Component;
  return {
    id: view.id,
    // A built-in view is a RIGHT-column view by construction: its floor, width
    // slot and workspace gate were all declared for that column.
    side: 'right',
    title: view.title,
    label: view.label,
    icon: view.icon,
    name: '',
    builtin: true,
    requiresWorkspace: view.requiresWorkspace,
    liveWhileHidden: view.liveWhileHidden === true,
    minWidth: view.minWidth,
    defaultWidth: view.defaultWidth,
    defaultFraction: view.defaultFraction,
    render: (props) => <View {...props} />,
  };
}

/**
 * The panel catalog the activity bars and the panel stacks render.
 *
 * `side` selects the column. `all` is deliberately a first-class value rather
 * than "no filter": the phone's drawer and the settings pane both need every
 * panel in one list, and a caller that forgot to pass a side would otherwise get
 * a silently halved catalog.
 */
export function usePanelCatalog(side: PanelCatalogSide = 'right'): ResolvedPanel[] {
  const { panels, disabledPanels } = usePanelRegistry();
  const { slots } = usePanelSlots();
  const { apply } = usePanelOrder();
  const dock = useLeftDock();

  return useMemo(() => {
    const out: ResolvedPanel[] = [];

    if (side !== 'left') {
      for (const view of enabledBuiltinPanels(disabledPanels)) out.push(builtinEntry(view));
    }

    const placed = new Map(dock.panels.map((id, index) => [id, index]));
    const left: ResolvedPanel[] = [];

    for (const panel of panels) {
      const entry = slots.get(panel.pluginId);
      const Component = entry ? rightPanelOf(entry) : undefined;
      if (!Component) continue;
      const key = pluginPanelKey(panel.pluginId);
      if (disabledPanels.includes(key)) continue;
      const size = entry?.sizing.rightPanel;
      const widths = resolvePluginPanelWidths({ ...size });
      const resolved: ResolvedPanel = {
        id: key,
        // Where the USER put it. A plugin registers one `rightPanel`; the dock
        // decides which column draws it, so one id keeps meaning one panel.
        side: panelSideOf(key, dock),
        title: `${entry?.titles.rightPanel ?? panel.name} — ${panel.name}`,
        label: entry?.titles.rightPanel ?? panel.name,
        name: panel.name,
        builtin: false,
        // A plugin reads whatever the host published and draws what it can, so
        // gating it on a workspace folder would hide a panel that works.
        requiresWorkspace: false,
        liveWhileHidden: false,
        minWidth: widths.min,
        defaultWidth: widths.px,
        defaultFraction: widths.fraction,
        ...(panel.iconUrl ? { iconUrl: panel.iconUrl } : {}),
        // Wrapped so the kit's participant hooks resolve THIS plugin's id while
        // its panel renders — the scope is what `useRpc`/`useRealtime` read.
        render: (props) => (
          <PluginIdProvider pluginId={panel.pluginId}>
            <Component sessionId={props.sessionId ?? null} workspacePath={null} />
          </PluginIdProvider>
        ),
      };
      if (resolved.side === 'left') left.push(resolved);
      else if (side !== 'left') out.push(resolved);
    }

    if (side !== 'right') {
      // The dock's own view first, then the placed plugins in PLACEMENT order:
      // on the left, putting a panel there IS the arrangement, so the right
      // column's dragged order would be a second answer to the same question.
      left.sort((a, b) => (placed.get(a.id) ?? 0) - (placed.get(b.id) ?? 0));
      out.unshift(SESSIONS_PANEL, ...left);
    }

    return side === 'left' ? out : apply(out);
  }, [panels, slots, disabledPanels, apply, dock, side]);
}

/** Whether a panel id names the dock's own session list. */
export function isSessionsPanel(id: string): boolean {
  return id === SESSIONS_VIEW_ID;
}

/**
 * Which view the dock actually shows, given the stored selection.
 *
 * Three answers, and they are different states a blank column would conflate:
 *
 * - the stored id is a LEFT panel → draw it;
 * - the stored id names a panel that still exists but lives on the RIGHT (the
 *   user moved it back, or it was never placed here) → the dock's own view,
 *   because that is not an error;
 * - the stored id names nothing at all (uninstalled, switched off) → the id is
 *   returned as-is so the dock can say WHY, which is what the panel position's
 *   notice exists for.
 */
export function useLeftDockView(stored: string, railEnabled: boolean): string {
  const left = usePanelCatalog('left');
  const all = usePanelCatalog('all');
  return useMemo(() => {
    // With no rail there is no control that switches views, so the dock shows
    // its own view: leaving a plugin panel up would strand the user there with
    // no way back to the session list.
    if (!railEnabled) return SESSIONS_VIEW_ID;
    if (left.some((panel) => panel.id === stored)) return stored;
    if (all.some((panel) => panel.id === stored)) return SESSIONS_VIEW_ID;
    return stored;
  }, [left, all, stored, railEnabled]);
}
