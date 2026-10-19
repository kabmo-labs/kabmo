import { useMemo } from 'preact/hooks';
import type { ComponentType, ReactNode } from 'preact/compat';
import type { RightPanelProps } from '@kabmo-labs/plugin-sdk/app';
import { usePanelRegistry, usePanelSlots } from '@/client/hooks/workspace/panel-registry';
import { usePanelOrder } from '@/client/hooks/workspace/panel-order';
import { pluginIdOf, pluginPanelKey } from '@/shared/lib/workspace/panel-ids';
import { resolvePluginPanelWidths } from '@/shared/lib/workspace/panel-widths';
import { PluginIdProvider } from '@kabmo-labs/ui';
import { panelOf, rightPanelOf } from '@/client/lib/plugins/slots';
import { PluginError } from '@/client/components/workspace/plugin-panel/Error';
import {
  enabledBuiltinPanels,
  type BuiltinPanelView,
  type PanelBodyProps,
} from '@/client/components/workspace/panels/builtin';

export type { PanelBodyProps };

/** One plugin's right-panel component, ready to render. */
export interface ResolvedPluginPanel {
  panelKey: string;
  pluginId: string;
  name: string;
  title: string;
  Component: ComponentType<RightPanelProps>;
  iconUrl?: string;
  /** Sizing the bundle declared, passed through to the width resolver. */
  minWidth?: number;
  defaultFraction?: number;
}

export interface PluginPanels {
  /** Every enabled plugin that contributes a right panel AND has loaded. */
  panels: ResolvedPluginPanel[];
  /** A plugin the layout still names but whose component is not available. */
  unresolved: { pluginId: string; reason: string } | null;
}

/**
 * Resolve the plugin panels the activity bar and the panel stack render.
 *
 * Two sources, and both are required: the REGISTRY says which plugins are
 * installed and enabled (and gives the icon), while the SLOTS say which
 * components actually registered (the bundle may still be importing, or may
 * have failed). A plugin that is enabled but not loaded contributes no button
 * yet — and if it failed, `failures` carries the reason.
 *
 * The order is the registry's, so the bar is stable across reloads instead of
 * following the order the imports happened to finish in.
 */
export function usePluginPanels(activePanel: string): PluginPanels {
  const { panels, errors } = usePanelRegistry();
  const { slots, failures } = usePanelSlots();

  const resolved = useMemo(() => {
    const out: ResolvedPluginPanel[] = [];
    for (const panel of panels) {
      const entry = slots.get(panel.pluginId);
      const Component = entry ? rightPanelOf(entry) : undefined;
      if (!Component) continue;
      const size = entry?.sizing.rightPanel;
      out.push({
        panelKey: pluginPanelKey(panel.pluginId),
        pluginId: panel.pluginId,
        name: panel.name,
        title: entry?.titles.rightPanel ?? panel.name,
        Component,
        ...(panel.iconUrl ? { iconUrl: panel.iconUrl } : {}),
        ...(size?.minWidth !== undefined ? { minWidth: size.minWidth } : {}),
        ...(size?.defaultFraction !== undefined ? { defaultFraction: size.defaultFraction } : {}),
      });
    }
    return out;
  }, [panels, slots]);

  // The active panel names a plugin that is not resolvable right now. A reason
  // is picked from the most specific source first: a load failure beats the
  // scan's own rejection, which beats "not installed".
  const unresolved = useMemo(() => {
    const pluginId = pluginIdOf(activePanel);
    if (!pluginId || resolved.some((panel) => panel.pluginId === pluginId)) return null;
    const failure = failures.find((entry) => entry.pluginId === pluginId);
    if (failure) return { pluginId, reason: failure.reason };
    const rejected = errors.find((entry) => entry.dir.includes(pluginId));
    if (rejected) return { pluginId, reason: rejected.reason };
    const known = panels.find((panel) => panel.pluginId === pluginId);
    if (known) return { pluginId, reason: 'the bundle has not loaded yet' };
    return { pluginId, reason: 'no plugin with this id is installed' };
  }, [activePanel, resolved, failures, errors, panels]);

  return { panels: resolved, unresolved };
}

/**
 * The notice a panel position shows when the selection names no drawable panel.
 *
 * A panel that IS available is drawn by the catalog's own `render`, which is the
 * only place that holds the props a body needs (its workspace, refresh key and
 * close handler). This is the other outcome: a selection naming a panel that is
 * switched off, uninstalled, or whose bundle has not loaded — three different
 * causes the user cannot tell apart from a blank column.
 */
export function PluginPanelBody({ panelKey }: { panelKey: string }) {
  const { unresolved } = usePluginPanels(panelKey);
  return <PluginError pluginId={unresolved?.pluginId ?? panelKey} reason={unresolved?.reason ?? 'not loaded'} />;
}

/**
 * Resolve the plugins that registered the generic `panel` slot.
 *
 * `panel` is the second place a view can live — the editor COLUMN, not an
 * editor. The host supplies no tabs, no file tree and no split; a plugin that
 * wants those builds them inside its own component. The slot is named for where
 * it renders, so nothing here assumes what it contains.
 */
export function usePanelSlotPlugins(): ResolvedPluginPanel[] {
  const { panels } = usePanelRegistry();
  const { slots } = usePanelSlots();

  return useMemo(() => {
    const out: ResolvedPluginPanel[] = [];
    for (const panel of panels) {
      const entry = slots.get(panel.pluginId);
      const Component = entry ? panelOf(entry) : undefined;
      if (!Component) continue;
      const size = entry?.sizing.panel;
      out.push({
        panelKey: pluginPanelKey(panel.pluginId),
        pluginId: panel.pluginId,
        name: panel.name,
        title: entry?.titles.panel ?? panel.name,
        Component: Component as ResolvedPluginPanel['Component'],
        ...(panel.iconUrl ? { iconUrl: panel.iconUrl } : {}),
        ...(size?.minWidth !== undefined ? { minWidth: size.minWidth } : {}),
        ...(size?.defaultFraction !== undefined ? { defaultFraction: size.defaultFraction } : {}),
      });
    }
    return out;
  }, [panels, slots]);
}

/**
 * Which plugin currently owns the editor column, or null.
 *
 * The column shows a plugin panel ONLY while the layout says so — there is no
 * tab strip for it, so this is the single source of that decision. A key naming
 * a plugin that is not installed, not enabled or not loaded resolves to null and
 * the column falls back to the file tabs, which is the honest answer rather than
 * an empty column.
 */
export function useActiveEditorPanel(activeKey: string | null): ResolvedPluginPanel | null {
  const plugins = usePanelSlotPlugins();
  return activeKey ? plugins.find((panel) => panel.panelKey === activeKey) ?? null : null;
}

/** A built-in view's catalog entry, with its renderer closed over its component. */
function builtinEntry(view: BuiltinPanelView): ResolvedPanel {
  const View = view.Component;
  return {
    id: view.id,
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

/** One panel in the merged catalog — a built-in view or an installed plugin. */
export interface ResolvedPanel {
  /** The panel id: a bare built-in view id, or `plugin:<pluginId>`. */
  id: string;
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
  /** Render the body. One call, so both layouts draw a view the same way. */
  render: (props: PanelBodyProps) => ReactNode;
}

/**
 * The panel catalog the activity bar and the panel stack render.
 *
 * ONE list, two sources: the built-in views (in `RIGHT_PANEL_TYPES` order) and
 * the installed plugins (in the registry's order). Enablement is ONE set of ids
 * — a built-in view is off by its bare id and a plugin by `plugin:<id>` — so a
 * view the user switched off disappears from the bar, the phone's strip and the
 * right-click menu alike, whichever kind it is.
 *
 * The BASE order is built-ins then plugins, which is what makes the bar stable
 * across reloads rather than following whichever import finished first; the
 * user's own order (`usePanelOrder`) is laid over it, so a dragged button stays
 * where it was put and a panel the order does not name keeps its base position.
 * Applied HERE rather than in the bar, because the desktop stack and the phone's
 * tab strip render from this same list — ordering at one call site would leave
 * the other two drawing the base order.
 */
export function usePanelCatalog(): ResolvedPanel[] {
  const { panels, disabledPanels } = usePanelRegistry();
  const { slots } = usePanelSlots();
  const { apply } = usePanelOrder();

  return useMemo(() => {
    const out: ResolvedPanel[] = [];

    for (const view of enabledBuiltinPanels(disabledPanels)) {
      out.push(builtinEntry(view));
    }

    for (const panel of panels) {
      const entry = slots.get(panel.pluginId);
      const Component = entry ? rightPanelOf(entry) : undefined;
      if (!Component) continue;
      const key = pluginPanelKey(panel.pluginId);
      if (disabledPanels.includes(key)) continue;
      const size = entry?.sizing.rightPanel;
      const widths = resolvePluginPanelWidths({ ...size });
      out.push({
        id: key,
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
      });
    }

    return apply(out);
  }, [panels, slots, disabledPanels, apply]);
}
