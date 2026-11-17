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
 * The PHONE header does not read this set. It has no context menu, so a control
 * hidden there would have no way back — the same reason the rail pins its
 * sessions view. The desktop navbar is the surface that owns the menu.
 */

import { useCallback, useSyncExternalStore } from 'preact/compat';
import { readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';

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
  editor: 'editor',
  rightPanel: 'right-panel',
  mobile: 'mobile',
} as const;

export type NavbarControlId = (typeof NAVBAR_CONTROL)[keyof typeof NAVBAR_CONTROL];

export interface NavbarControlItem {
  id: NavbarControlId;
  title: string;
}

/**
 * Every control the menu can switch, in the row's own order.
 *
 * The window's caption buttons are not here: they are the window's, not the
 * page's, and a hidden close button is a window the user cannot close. The
 * sidebar's expand button is not here either — while the sidebar is collapsed
 * it is the only mouse way back, the same reason the rail pins its sessions
 * view.
 */
export const NAVBAR_CONTROLS: NavbarControlItem[] = [
  { id: NAVBAR_CONTROL.install, title: 'Install app' },
  { id: NAVBAR_CONTROL.reload, title: 'Reload page' },
  { id: NAVBAR_CONTROL.context, title: 'Context usage' },
  { id: NAVBAR_CONTROL.signout, title: 'Sign out' },
  { id: NAVBAR_CONTROL.editor, title: 'Editor layout' },
  { id: NAVBAR_CONTROL.rightPanel, title: 'Right panel' },
  { id: NAVBAR_CONTROL.mobile, title: 'Mobile view' },
];

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
 * An id this build does not know is DROPPED rather than kept: the set is also
 * the row's own switch, so a stale id would hide nothing and the menu would
 * show a checkbox for a control that no longer exists.
 */
export function readHiddenControls(): string[] {
  const source = readKabmoSetting<unknown>(NAVBAR_HIDDEN_SETTING_KEY);
  if (source === lastSource) return cached;
  lastSource = source;
  const known = new Set<string>(NAVBAR_CONTROLS.map((item) => item.id));
  cached = Array.isArray(source)
    ? [...new Set(source.filter((id): id is string => typeof id === 'string' && known.has(id)))]
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
