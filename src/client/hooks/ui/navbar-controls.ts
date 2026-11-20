/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which top-navbar controls the user switched off.
 *
 * The activity rails have had this since they existed: right-click the rail and
 * every view is a checkbox, so a control the user never presses can be removed
 * without losing the way back. The navbar's own buttons had no such switch, so
 * a row of six controls was all-or-nothing.
 *
 * Stored GLOBAL (`app_settings.omp_navbar_hidden_controls`): the navbar is the
 * same row in every session, so a per-session set would move the user's own
 * arrangement when they picked another chat.
 *
 * BOTH headers read this set: the desktop navbar's right-click and the phone's
 * long-press open the same `VisibilityMenu`, so a control switched off on one
 * layout is off on the other rather than silently returning after a resize.
 *
 * A PLUGIN's header entry is a control too. Its id is `plugin:<pluginId>` —
 * the enablement key's own form — so the menu row, the stored set and the
 * entry the plugin registered all name the same thing. A plugin's bundle may
 * not have loaded yet when the set is read, which is why validation accepts
 * the SHAPE of a plugin id instead of resolving it against the registry:
 * dropping it on a slow import would switch the user's choice back on.
 *
 * The layout switch is NOT here either: it moved to the sidebar footer, where
 * the phone's own mirror control ("Desktop") sits in the same slot. A control
 * that lives in one layout's row and the other layout's footer has no single
 * row for this menu to hide.
 */

import { useCallback, useSyncExternalStore } from 'preact/compat';
import { readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';
import { PLUGIN_PANEL_PREFIX } from '@/shared/lib/workspace/panel-ids';

/** `app_settings` key holding the hidden control ids. */
export const NAVBAR_HIDDEN_SETTING_KEY = 'omp_navbar_hidden_controls';

/**
 * The ids the menu and the row share.
 *
 * Stated once so a menu row and the control it switches cannot drift: a typo in
 * either place would leave a checkbox that hides nothing.
 */
export const NAVBAR_CONTROL = {
  install: 'install',
  reload: 'reload',
  context: 'context',
  signout: 'signout',
  rightPanel: 'right-panel',
} as const;

export type NavbarControlId = (typeof NAVBAR_CONTROL)[keyof typeof NAVBAR_CONTROL];

export interface NavbarControlItem {
  /** A built-in control id, or `plugin:<pluginId>` for a plugin's entry. */
  id: string;
  title: string;
}

/** A plugin entry the row can draw, as the menu needs to name it. */
export interface NavbarPluginEntry {
  pluginId: string;
  title: string;
}

/**
 * The id a plugin's navbar entry is switched by: `plugin:<pluginId>`.
 *
 * The same string `pluginEnablementKey` produces, deliberately: one plugin is
 * one id across the panel catalog, the enablement rows and this menu, so a
 * stored choice cannot belong to a control that no longer exists under that
 * name. It is NOT a `plugin:<pluginId>:<slot>` panel instance key — a header
 * entry is the plugin's, not one of its panels.
 */
export function navbarPluginControlId(pluginId: string): string {
  return `${PLUGIN_PANEL_PREFIX}${pluginId}`;
}

/** Whether an id names a plugin's navbar entry (and not one of its panels). */
export function isNavbarPluginControlId(id: string): boolean {
  if (!id.startsWith(PLUGIN_PANEL_PREFIX)) return false;
  const pluginId = id.slice(PLUGIN_PANEL_PREFIX.length);
  return pluginId.length > 0 && !pluginId.includes(':');
}

/** Each built-in control's menu label. */
const CONTROL_TITLES: Record<NavbarControlId, string> = {
  install: 'Install app',
  reload: 'Reload page',
  context: 'Context usage',
  signout: 'Sign out',
  'right-panel': 'Right side',
};

/**
 * The BUILT-IN controls the menu can switch, in the row's own order.
 *
 * The plugin entries are not here — they are a runtime fact, and
 * `navbarControlItems` splices them where the row draws them.
 *
 * The window's caption buttons are not here: they are the window's, not the
 * page's, and a hidden close button is a window the user cannot close. The
 * sidebar's expand button is not here either — while the sidebar is collapsed
 * it is the only mouse way back, the same reason the rail pins its sessions
 * view.
 */
export const NAVBAR_CONTROLS: NavbarControlItem[] = (
  [
    NAVBAR_CONTROL.install,
    NAVBAR_CONTROL.reload,
    NAVBAR_CONTROL.context,
    NAVBAR_CONTROL.signout,
    NAVBAR_CONTROL.rightPanel,
  ] satisfies NavbarControlId[]
).map((id) => ({ id, title: CONTROL_TITLES[id] }));

/**
 * What the menu lists, in the row's own order: install, the plugins' entries,
 * then reload, context, sign-out and the right side.
 *
 * Built here rather than at each surface so the menu and the row cannot drift
 * when a plugin is installed or removed: a plugin that adds a control adds a
 * menu row, and the two headers that offer the menu list it in the same place
 * the row draws it.
 */
export function navbarControlItems(plugins: readonly NavbarPluginEntry[]): NavbarControlItem[] {
  return NAVBAR_CONTROLS.flatMap((item) =>
    item.id === NAVBAR_CONTROL.install
      ? [item, ...plugins.map((plugin) => ({ id: navbarPluginControlId(plugin.pluginId), title: plugin.title }))]
      : [item],
  );
}

const listeners = new Set<() => void>();

/** The stored value the cache was built from, and the set it produced. */
let lastSource: unknown;
let cached: string[] = [];

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The stored set, validated.
 *
 * An id this build does not know is DROPPED rather than kept, with ONE
 * exception: a plugin's id is validated by its SHAPE (`plugin:<pluginId>`),
 * because the set may be read before that plugin's bundle has loaded. Dropping
 * it then would switch the user's choice back on at the next render.
 */
export function readHiddenControls(): string[] {
  const source = readKabmoSetting<unknown>(NAVBAR_HIDDEN_SETTING_KEY);
  if (source === lastSource) return cached;
  lastSource = source;
  const known = new Set<string>(NAVBAR_CONTROLS.map((item) => item.id));
  cached = Array.isArray(source)
    ? [
        ...new Set(
          source.filter(
            (id): id is string =>
              typeof id === 'string' && (known.has(id) || isNavbarPluginControlId(id)),
          ),
        ),
      ]
    : [];
  return cached;
}

/** The next set after one toggle. Pure, so the menu's rule is testable. */
export function toggleHiddenControl(hidden: readonly string[], id: string, visible: boolean): string[] {
  if (visible) return hidden.filter((value) => value !== id);
  return hidden.includes(id) ? [...hidden] : [...hidden, id];
}

function publish(): void {
  lastSource = undefined;
  for (const listener of listeners) listener();
}

export function useNavbarControls(): { hidden: string[]; setHidden: (id: string, visible: boolean) => void } {
  const hidden = useSyncExternalStore(subscribe, readHiddenControls);
  const setHidden = useCallback((id: string, visible: boolean) => {
    writeSetting(NAVBAR_HIDDEN_SETTING_KEY, toggleHiddenControl(readHiddenControls(), id, visible));
    publish();
  }, []);
  return { hidden, setHidden };
}
