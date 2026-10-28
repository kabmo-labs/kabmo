/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The app-side contract: what a plugin's bundle exports and what the host
 * provides it at runtime.
 *
 * A plugin ships ONE ESM bundle (`dist/app.js`) that the host `import()`s into
 * the page. Its default export is a {@link PluginAppDefinition} built by
 * {@link definePluginApp}; calling `setup(app)` registers components into named
 * slots, and the host renders those components IN ITS OWN TREE — the same
 * Preact instance, the same document, the same theme. There is no iframe and no
 * message channel: a plugin is local code, trusted the way a VS Code extension
 * is trusted.
 *
 * This file is TYPES ONLY apart from `definePluginApp`, and that is what makes
 * it safe to bundle into every plugin: the runtime half (`preact`, `preact/hooks`,
 * `preact/jsx-runtime`, `@kabmo-labs/kabmo-ui`, and the host hooks) is NOT bundled —
 * the build marks those specifiers external and the host answers them from
 * `globalThis.__kabmoPluginRuntime`. One Preact for the host and every
 * plugin is what keeps hooks working; two copies produce the
 * `Cannot read properties of undefined (reading '__H')` failure.
 */

import type { ComponentType } from 'preact';
import type { PluginListSlots } from './slots';

/** Where a contributed panel renders. One panel per position, per plugin. */
export type PanelPosition = 'right' | 'editor' | 'header';

/** What a plugin may register, and what the host will call it with. */

/** Props for a `right` panel: it owns the right panel's whole body. */
export interface RightPanelProps {
  /** The active session id, or null. */
  sessionId: string | null;
  /** The active workspace root, or null. */
  workspacePath: string | null;
}

/**
 * Props for a `panel`: it owns the editor column's whole body.
 *
 * `panel` is the GENERIC slot — a second place a view can live, not an editor.
 * A plugin that wants tabs, a file tree or a split builds them itself inside
 * its component; the host supplies none of that. So the name describes WHERE it
 * renders, not what it must look like.
 */
export type PanelProps = RightPanelProps;

/** Props for a header TRIGGER: whatever the navbar button should read. */
export type HeaderTriggerProps = RightPanelProps;

/**
 * Props for a header DROPDOWN, which is a separate component from the trigger.
 *
 * The split is the point: a trigger is a readout (`10tps ⛁10GB`) that the host
 * makes clickable, and the dropdown is what opening it shows. A header with no
 * dropdown is therefore a plain readout with no interaction at all.
 */
export type HeaderDropdownProps = RightPanelProps;

/** Props for a `settingsSection`: it owns a block in the plugin's settings pane. */
export interface SettingsSectionProps {
  /** The plugin this section belongs to, so a shared bundle can branch on it. */
  pluginId: string;
}

/** One registration's identity: unique within the plugin and stable across reloads. */
export interface SlotRegistration {
  id: string;
  title?: string;
}

/**
 * Sizing a panel may declare. Absent means the slot's own default.
 *
 * Declared in code rather than in the manifest because the registration is the
 * only place a panel exists: a plugin that draws a wide table says so next to
 * the component, and a plugin that does not gets Kabmo's default.
 */
export interface PanelSizing {
  /** Floor in px before the panel's content clips. Never below 320. */
  minWidth?: number;
  /** Share of the group's area the panel opens at. Clamped to 0.2–0.9. */
  defaultFraction?: number;
}

export interface RightPanelRegistration extends SlotRegistration, PanelSizing {
  component: ComponentType<RightPanelProps>;
}

export interface PanelRegistration extends SlotRegistration, PanelSizing {
  component: ComponentType<PanelProps>;
}

/**
 * A header registration: the TRIGGER, plus an optional dropdown.
 *
 * `component` renders what the navbar button reads — text, an icon, a
 * `10tps ⛁10GB` readout, anything. When `dropdown` is present the host wraps the
 * trigger in a real button and opens that component below it; when it is absent
 * the trigger is a static readout and the host renders no button at all, so a
 * plugin cannot promise an interaction it does not have.
 */
export interface HeaderPanelRegistration extends SlotRegistration {
  component: ComponentType<HeaderTriggerProps>;
  dropdown?: { component: ComponentType<HeaderDropdownProps> };
  /**
   * Make the trigger an ACTION that opens one of this plugin's own panels.
   *
   * The value names the SLOT, not a column: `'rightPanel'` opens what
   * `app.rightPanel(...)` registered, `'panel'` what `app.panel(...)` did. The
   * host resolves it to that panel's instance key (`plugin:<id>:<slot>`) and
   * opens it WHERE THE USER PLACED IT — the left dock, the right column, the
   * editor column, or the phone drawer that holds it. A plugin therefore never
   * names a column, and a user who moved the panel did not break the readout.
   *
   * Without it the trigger stays what it always was: inert text when there is
   * no `dropdown`, a dropdown button when there is.
   */
  opensPanel?: 'rightPanel' | 'panel';
}

export interface SettingsSectionRegistration extends SlotRegistration {
  component: ComponentType<SettingsSectionProps>;
}

/**
 * The registrar the host hands to `setup`.
 *
 * Each POSITIONAL method is a slot that takes AT MOST ONE registration — the
 * layout gives a plugin one activity-bar button, one navbar entry and one
 * editor-column view, so a second `rightPanel` would be unreachable.
 * Registering twice throws rather than silently replacing, because a plugin
 * that tried is broken and a quiet overwrite would hide it.
 *
 * The list slots (see `./slots`) are the other kind: `PluginListSlots` methods
 * take a keyed registration and return a disposer, because a row among rows can
 * be added and removed without touching its neighbours.
 */
export interface PluginApp extends PluginListSlots {
  readonly pluginId: string;
  rightPanel(registration: RightPanelRegistration): void;
  panel(registration: PanelRegistration): void;
  headerPanel(registration: HeaderPanelRegistration): void;
  settingsSection(registration: SettingsSectionRegistration): void;
}

/** A plugin's default export. */
export interface PluginAppDefinition {
  readonly __kabmoPluginApp: true;
  readonly setup: PluginAppSetup;
}

export type PluginAppSetup = (app: PluginApp) => void;

/**
 * Declare a plugin's app.
 *
 * The whole reason this is a function rather than an exported object: it gives
 * the host one validated shape to look for, and it fails loudly when a plugin
 * exports the setup function directly (the mistake that otherwise shows up as
 * "the plugin loaded and did nothing").
 */
export function definePluginApp(setup: PluginAppSetup): PluginAppDefinition {
  if (typeof setup !== 'function') {
    throw new Error('definePluginApp expects a setup function');
  }
  return Object.freeze({ __kabmoPluginApp: true as const, setup });
}

/** Whether a loaded module's default export is a plugin app. */
export function isPluginAppDefinition(value: unknown): value is PluginAppDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { __kabmoPluginApp?: unknown; setup?: unknown };
  return candidate.__kabmoPluginApp === true && typeof candidate.setup === 'function';
}

/**
 * What the host puts on `globalThis.__kabmoPluginRuntime`.
 *
 * The build rewrites every specifier below to read from this object instead of
 * bundling its own copy. `preact`, `hooks` and `jsxRuntime` MUST be the host's
 * instances: a component rendered by the host's tree but created by a second
 * Preact copy is a component the host's hooks cannot see.
 */
export interface PluginRuntimeSlots {
  preact: unknown;
  hooks: unknown;
  jsxRuntime: unknown;
  jsxDevRuntime: unknown;
  ui: unknown;
  uiComponents: unknown;
}

/** The global the runtime is published on. One name, host and plugin agree. */
export const PLUGIN_RUNTIME_GLOBAL = '__kabmoPluginRuntime';

/** Read the runtime, or throw naming the real problem. */
export function pluginRuntime(): PluginRuntimeSlots {
  const runtime = (globalThis as { __kabmoPluginRuntime?: PluginRuntimeSlots }).__kabmoPluginRuntime;
  if (!runtime) {
    throw new Error(
      'The Kabmo plugin runtime is unavailable — this bundle must be loaded by Kabmo app.',
    );
  }
  return runtime;
}
