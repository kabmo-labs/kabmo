/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The registrations plugin bundles have made, in load order.
 *
 * A plugin's components are registered by CALLING `setup(app)`, so the list of
 * slots only exists once the bundle has run. This store is where the loader
 * puts them and where every surface reads them from — the activity bar, the
 * panel stack, the navbar dropdown, the editor tab and the settings pane all
 * resolve a component the same way the layout resolves a panel key.
 *
 * A plugin registers AT MOST ONE component per slot, and a second registration
 * THROWS rather than overwriting: the layout gives a plugin one activity-bar
 * button, one navbar button and one editor tab, so a second `rightPanel` is
 * unreachable, and a quiet overwrite would hide a plugin that is broken.
 *
 * A module-level store is enough here (unlike the terminal registry or the
 * database) because it describes the CLIENT's loaded bundles: a full page load
 * re-imports every plugin and rebuilds it, and there is nothing to survive.
 */

import type { ComponentType } from 'preact';
import type {
  HeaderDropdownProps,
  HeaderTriggerProps,
  PanelProps,
  PluginApp,
  PluginAppDefinition,
  RightPanelProps,
  SettingsSectionProps,
} from '@ompchamber/plugin-sdk/app';
import { isPluginAppDefinition } from '@ompchamber/plugin-sdk/app';
import { clearPluginListSlots, registerListSlot } from '@/client/lib/plugins/list-slots';

/** The four slots a plugin may fill, one component each. */
export type SlotName = 'rightPanel' | 'panel' | 'headerPanel' | 'settingsSection';

export const SLOT_NAMES: readonly SlotName[] = ['rightPanel', 'panel', 'headerPanel', 'settingsSection'];

/**
 * One plugin's registrations.
 *
 * `components` holds components with DIFFERENT prop shapes under one key type,
 * which no single precise type can express. It is deliberately `unknown` and
 * the store's internal shape: callers read a slot through the typed accessors
 * below, which is where the props type is recovered — the registration already
 * proved the value is a component, and the props type is the contract's, not
 * something runtime checking could establish.
 */
export interface PluginSlots {
  pluginId: string;
  components: Partial<Record<SlotName, unknown>>;
  /** Titles the bundle declared, for a button tooltip or a tab label. */
  titles: Partial<Record<SlotName, string>>;
  /** Sizing the bundle declared for its panels, where it declared any. */
  sizing: Partial<Record<'rightPanel' | 'panel', { minWidth?: number; defaultFraction?: number }>>;
  /**
   * The header's dropdown, when it declared one.
   *
   * Held apart from `components` because it is not a slot: a header panel is ONE
   * slot whose trigger and dropdown are two components, and a header without a
   * dropdown is a static readout rather than a broken button.
   */
  headerDropdown?: unknown;
}

/** One plugin's bundle could not be loaded, or refused to register. */
export interface PluginLoadFailure {
  pluginId: string;
  reason: string;
}

export interface PluginSlotState {
  /** Registrations by plugin id. */
  slots: Map<string, PluginSlots>;
  failures: PluginLoadFailure[];
}

const EMPTY: PluginSlotState = { slots: new Map(), failures: [] };

type Listener = () => void;

let state: PluginSlotState = EMPTY;
const listeners = new Set<Listener>();

/** Read the current registrations. Identity is stable until a write. */
export function pluginSlotState(): PluginSlotState {
  return state;
}

export function subscribePluginSlots(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: PluginSlotState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** The component one plugin registered for a slot, with its props type back. */
export function rightPanelOf(slots: PluginSlots): ComponentType<RightPanelProps> | undefined {
  return slots.components.rightPanel as ComponentType<RightPanelProps> | undefined;
}

export function panelOf(slots: PluginSlots): ComponentType<PanelProps> | undefined {
  return slots.components.panel as ComponentType<PanelProps> | undefined;
}

export function headerTriggerOf(slots: PluginSlots): ComponentType<HeaderTriggerProps> | undefined {
  return slots.components.headerPanel as ComponentType<HeaderTriggerProps> | undefined;
}

/** The header's dropdown component, when the registration declared one. */
export function headerDropdownOf(slots: PluginSlots): ComponentType<HeaderDropdownProps> | undefined {
  return slots.headerDropdown as ComponentType<HeaderDropdownProps> | undefined;
}

export function settingsSectionOf(slots: PluginSlots): ComponentType<SettingsSectionProps> | undefined {
  return slots.components.settingsSection as ComponentType<SettingsSectionProps> | undefined;
}

/**
 * Run one bundle's setup and keep what it registered.
 *
 * The default export is validated BEFORE `setup` is called, because the two
 * ways a plugin gets this wrong otherwise produce the same silence: exporting
 * the setup function directly (so there is no definition to find), and
 * exporting nothing at all. Both are reported by name.
 */
export function registerPluginBundle(pluginId: string, module: unknown): void {
  const definition = (module as { default?: unknown } | null)?.default;
  if (!isPluginAppDefinition(definition)) {
    failPluginBundle(pluginId, 'the bundle has no definePluginApp(...) default export');
    return;
  }

  const components: PluginSlots['components'] = {};
  const titles: PluginSlots['titles'] = {};
  const sizing: PluginSlots['sizing'] = {};
  let headerDropdown: unknown;

  // A bundle re-imported under a new URL (a rebuild) registers AGAIN, and the
  // list slots refuse a duplicate id — so the previous rows go first. Doing it
  // here rather than per registration is what keeps a rebuilt plugin from
  // throwing on its own ids.
  clearPluginListSlots(pluginId);

  const register = (
    slot: SlotName,
    component: unknown,
    id: string,
    title?: string,
    size?: { minWidth?: number; defaultFraction?: number },
  ) => {
    if (typeof component !== 'function' && typeof component !== 'object') {
      throw new Error(`${slot} "${id}" has no component`);
    }
    if (components[slot]) throw new Error(`a plugin may register only one ${slot}`);
    components[slot] = component;
    if (title) titles[slot] = title;
    if (size && (slot === 'rightPanel' || slot === 'panel')) sizing[slot] = size;
  };

  const app: PluginApp = {
    pluginId,
    rightPanel: ({ id, title, component, minWidth, defaultFraction }) =>
      register('rightPanel', component, id, title, { minWidth, defaultFraction }),
    panel: ({ id, title, component, minWidth, defaultFraction }) =>
      register('panel', component, id, title, { minWidth, defaultFraction }),
    headerPanel: ({ id, title, component, dropdown }) => {
      register('headerPanel', component, id, title);
      if (dropdown) headerDropdown = dropdown.component;
    },
    settingsSection: ({ id, title, component }) => register('settingsSection', component, id, title),
    // The list slots: each is a keyed registration that RETURNS its own
    // disposer, which the plugin may call to take one row back. They are not
    // tracked here — `clearPluginListSlots` at the top of this function is what
    // a re-registration relies on, and the disposer the plugin holds is the
    // only handle that should ever remove its row.
    messageAction: (registration) => registerListSlot(pluginId, 'messageAction', registration),
    commandPaletteAction: (registration) => registerListSlot(pluginId, 'commandPaletteAction', registration),
    fileOpener: (registration) => registerListSlot(pluginId, 'fileOpener', registration),
    sourceCodeRenderer: (registration) => registerListSlot(pluginId, 'sourceCodeRenderer', registration),
    diffRenderer: (registration) => registerListSlot(pluginId, 'diffRenderer', registration),
    timelineRenderer: (registration) => registerListSlot(pluginId, 'timelineRenderer', registration),
    composerAction: (registration) => registerListSlot(pluginId, 'composerAction', registration),
    composerBanner: (registration) => registerListSlot(pluginId, 'composerBanner', registration),
  };

  try {
    (definition as PluginAppDefinition).setup(app);
  } catch (error) {
    failPluginBundle(pluginId, error instanceof Error ? error.message : String(error));
    return;
  }

  const slots = new Map(state.slots);
  slots.set(pluginId, {
    pluginId,
    components,
    titles,
    sizing,
    ...(headerDropdown ? { headerDropdown } : {}),
  });
  publish({ slots, failures: state.failures.filter((entry) => entry.pluginId !== pluginId) });
}

/** Record a bundle that could not load. Reported in the pane, never silent. */
export function failPluginBundle(pluginId: string, reason: string): void {
  publish({
    slots: state.slots,
    failures: [...state.failures.filter((entry) => entry.pluginId !== pluginId), { pluginId, reason }],
  });
}

/** Drop everything — used by the loader before a re-import, and by tests. */
export function resetPluginSlots(): void {
  publish(EMPTY);
}
