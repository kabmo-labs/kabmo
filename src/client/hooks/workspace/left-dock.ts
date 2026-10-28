/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The left dock's state, as the desktop layout and its bar read it.
 *
 * Backed by the GLOBAL `app_settings.omp_left_panels` (see
 * `shared/lib/workspace/left-dock.ts`), not by `layout.*` session state: the
 * dock lists the same views in every chat, so a placement stored per session
 * would move the user's arrangement when they picked another session.
 *
 * The read is synchronous from the primed settings snapshot, so the first render
 * already knows whether the bar is drawn. A write notifies every reader on
 * screen, because they all resolve against this one module-level cache.
 *
 * The snapshot is compared by IDENTITY of the stored value: `writeSetting`
 * replaces it with the exact object a write handed it, so a reference comparison
 * is both correct and free — a rebuilt object would make
 * `useSyncExternalStore` see a change on every render and loop.
 */
import { useCallback, useEffect, useState } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import { readKabmoSetting } from '@/shared/lib/settings/client';
import {
  LEFT_DOCK_SETTING_KEY,
  readLeftDock,
  setPanelSide as persistPanelSide,
  writeLeftDock,
  type LeftDockState,
  type PanelSide,
} from '@/shared/lib/workspace/left-dock';
import { resolveLeftDockWidth, saveLeftDockWidth } from '@/shared/lib/workspace/left-dock-width';

const listeners = new Set<() => void>();

/** The stored value the cache was built from, and the state it produced. */
let lastSource: unknown;
let cached: LeftDockState = { enabled: false, panels: [] };

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): LeftDockState {
  const source = readKabmoSetting<unknown>(LEFT_DOCK_SETTING_KEY);
  if (source === lastSource) return cached;
  lastSource = source;
  cached = readLeftDock();
  return cached;
}

function publish(): void {
  lastSource = undefined;
  for (const listener of listeners) listener();
}

export interface LeftDockHandle extends LeftDockState {
  /** Draw the dock's activity bar. Off by default. */
  setEnabled: (enabled: boolean) => void;
  /**
   * Place a plugin panel on the left, or send it back to the right.
   *
   * Placing a panel TURNS THE RAIL ON. The rail exists to reach the panels on
   * it, so leaving it off after a successful placement would be a move with no
   * button, no view and no way to undo it from the bar — the settings row would
   * be the only control, which is exactly the state a user reads as broken.
   * Moving a panel back to the right does NOT turn the rail off: that is the
   * user's switch, and the dock may still be worth showing.
   */
  setSide: (panelId: string, side: PanelSide) => void;
  /** The width this view opens at, and the writer a drag commits through. */
  widthOf: (viewId: string) => number;
  commitWidth: (viewId: string, px: number) => void;
}

export function useLeftDock(): LeftDockHandle {
  const state = useSyncExternalStore(subscribe, snapshot);

  const setEnabled = useCallback((enabled: boolean) => {
    writeLeftDock({ enabled });
    publish();
  }, []);

  const setSide = useCallback((panelId: string, side: PanelSide) => {
    // The coupling — placing a panel also shows the rail — lives in the store,
    // so a second caller cannot produce a placement nobody can reach.
    persistPanelSide(panelId, side);
    publish();
  }, []);

  const commitWidth = useCallback((viewId: string, px: number) => {
    saveLeftDockWidth(viewId, px);
    publish();
  }, []);

  return {
    ...state,
    setEnabled,
    setSide,
    widthOf: resolveLeftDockWidth,
    commitWidth,
  };
}

/**
 * The dock's width for ONE view.
 *
 * Per view because a session list reads at 280px and a plugin's table does not:
 * a column that snapped to the list's width the moment the user switched views
 * would be a column with one width that is wrong for every second view.
 */
export function useLeftDockWidth(viewId: string): [number, (px: number) => void] {
  const dock = useLeftDock();
  const [width, setWidth] = useState(() => dock.widthOf(viewId));

  useEffect(() => {
    setWidth(dock.widthOf(viewId));
  }, [viewId, dock]);

  const commitWidth = useCallback(
    (px: number) => {
      dock.commitWidth(viewId, px);
      setWidth(dock.widthOf(viewId));
    },
    [dock, viewId],
  );

  return [width, commitWidth];
}
