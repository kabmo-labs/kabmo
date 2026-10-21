import { useMemo } from 'preact/hooks';
import type { ComponentType } from 'preact/compat';
import type { RightPanelProps } from '@kabmo-labs/kabmo-sdk/app';
import { usePanelRegistry, usePanelSlots } from '@/client/hooks/workspace/panel-registry';
import { pluginEnablementKey, pluginIdOf, pluginPanelKey } from '@/shared/lib/workspace/panel-ids';
import { panelSideOf } from '@/shared/lib/workspace/left-dock';
import { useLeftDock } from '@/client/hooks/workspace/left-dock';
import { panelOf, rightPanelOf } from '@/client/lib/plugins/slots';
import { PluginError } from '@/client/components/workspace/plugin-panel/Error';
import type { PanelBodyProps } from '@/client/components/workspace/panels/builtin';

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
        panelKey: pluginPanelKey(panel.pluginId, 'rightPanel'),
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
  const { panels, disabledPanels } = usePanelRegistry();
  const { slots } = usePanelSlots();
  const dock = useLeftDock();

  return useMemo(() => {
    const out: ResolvedPluginPanel[] = [];
    for (const panel of panels) {
      const entry = slots.get(panel.pluginId);
      const Component = entry ? panelOf(entry) : undefined;
      if (!Component) continue;
      // Enablement is per PLUGIN, so a switched-off plugin contributes nothing
      // to any column — the same rule the right-panel catalog uses.
      if (disabledPanels.includes(pluginEnablementKey(panel.pluginId))) continue;
      const key = pluginPanelKey(panel.pluginId, 'panel');
      // The column is one destination, and a `panel` slot only rides it. A row
      // in the dock's placement list naming this instance is therefore ignored
      // by `panelSideOf`'s slot rule rather than honoured.
      if (panelSideOf(key, dock) !== 'editor') continue;
      const size = entry?.sizing.panel;
      out.push({
        panelKey: key,
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
  }, [panels, slots, disabledPanels, dock]);
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

export { usePanelCatalog, isSessionsPanel, type PanelCatalogSide, type ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
