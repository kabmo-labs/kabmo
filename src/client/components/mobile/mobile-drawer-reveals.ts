/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone layout's two drawers, as SCREENS: which one a request opens, and
 * whether that request was a REVEAL.
 *
 * Both facts used to live inline in `LayoutWrapper`, and they are one subject:
 * a drawer is not a column. It has no persistent strip to watch — the right one
 * unmounts when it closes, and the left one's screen stays mounted so its
 * drawer has no mount edge at all — which is why a header press and a named
 * request (`omp:open-panel` from the Stats readout) have to be told apart by
 * something other than "the drawer appeared".
 *
 * `revealSignal` is that something: a counter bumped ONLY by the header control
 * that asks for the drawer, which the drawer reads through `useRevealSignal` and
 * turns into "leave the catalog and show a view" (`panel-tabs-reveal`). A named
 * request CLEARS the right drawer's counter, because it already says which view
 * it wants and the stored tab is the answer.
 *
 * Extracted for the file ceiling, and it earns the boundary: the reveal rule,
 * the keyboard arming and the drawer/screen mapping are one decision a reader
 * should be able to follow without the layout's editor, drop target and diff
 * screens in the way.
 */

import { useCallback, useState } from 'preact/hooks';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { getSessionValue, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { DEFAULT_RIGHT_PANEL_TYPE } from '@/shared/lib/workspace/right-panels';
import { armTerminalSoftKeyboard } from '@/client/components/workspace/terminal-panel/soft-keyboard';
import { OPEN_PANEL_EVENT, phoneDrawerForPanel, type OpenPanelDetail } from '@/shared/lib/workspace/panel-open';
import type { LeftDockHandle } from '@/client/hooks/workspace/left-dock';

/** The phone's three screens. The drawers ARE two of them. */
export type MobileScreen = 'main' | 'session' | 'right';

export interface MobileDrawerReveals {
  /** The counter the right drawer compares against — see this module's doc. */
  right: number;
  /** The counter the left drawer compares against. */
  left: number;
  /** The header's "Open Sessions": a reveal of the left drawer. */
  openSessionDrawer: () => void;
  /** The header's "Open Right Panel": a reveal of the right drawer. */
  openRightDrawer: () => void;
  /** `omp:open-panel` from a plugin's navbar readout, resolved by placement. */
  openNamedPanel: (panelKey: string) => void;
}

export interface MobileDrawerRevealInput {
  dock: LeftDockHandle;
  sessionId: string;
  currentScreen: MobileScreen;
  setCurrentScreen: (screen: MobileScreen) => void;
}

/**
 * The reveal counters, and the three gestures that move them.
 *
 * A hook rather than a plain function because the counters are render state: a
 * drawer that reads them must re-render when the header presses, and the
 * `omp:open-panel` listener must see the CURRENT screen (a request while the
 * drawer is already on screen does not re-arm the keyboard).
 */
export function useMobileDrawerReveals({
  dock,
  sessionId,
  currentScreen,
  setCurrentScreen,
}: MobileDrawerRevealInput): MobileDrawerReveals {
  const [right, setRight] = useState(0);
  const [left, setLeft] = useState(0);

  // The right drawer is a SCREEN: opening it is the tap that can summon the
  // keyboard, but the terminal mounts after it. Arm it for the tab the drawer
  // will open on; the drawer releases it if another view resolves.
  const openRightDrawer = useCallback(() => {
    const stored = getSessionValue<string>(sessionId, 'layout.mobileRightPanel') ?? DEFAULT_RIGHT_PANEL_TYPE;
    armTerminalSoftKeyboard(stored);
    setRight((count) => count + 1);
    setCurrentScreen('right');
  }, [sessionId, setCurrentScreen]);

  // The session screen is mounted permanently (its status-ack effect must run
  // while it is closed), so its drawer has no mount edge at all — the counter is
  // the only thing that can say "the header asked for this". It only ever grows,
  // so each press is one reveal and a press while the drawer is already open is
  // not one (`useRevealSignal` compares against the last value it saw).
  const openSessionDrawer = useCallback(() => {
    setLeft((count) => count + 1);
    setCurrentScreen('session');
  }, [setCurrentScreen]);

  /**
   * A plugin's navbar readout asking for its own panel.
   *
   * A phone has no rail, so "show this panel" is two decisions — which DRAWER
   * reaches it and which chip inside it — both answered by `phoneDrawerForPanel`
   * from the PLACEMENT, never from the panel's slot. The tab is written through
   * the store because the drawer mounts on this screen change and reads the
   * stored tab; an `editor` takeover resolves to null and the click does nothing
   * rather than opening a drawer that cannot show it.
   */
  const openNamedPanel = useCallback(
    (panelKey: string) => {
      const drawer = phoneDrawerForPanel(panelKey, dock);
      if (!drawer) return;
      // Same gesture rule as the header's button: arm the keyboard before the
      // terminal mounts, but never for the view already on screen (it is
      // focused).
      const stored = getSessionValue<string>(sessionId, 'layout.mobileRightPanel');
      if (drawer === 'right' && (currentScreen !== 'right' || stored !== panelKey)) {
        armTerminalSoftKeyboard(panelKey);
      }
      // The phone's two drawers are SCREENS, not columns: the session screen
      // draws the left dock and the right screen draws the panel drawer.
      setSessionKey(sessionId, drawer === 'left' ? 'layout.mobileLeftPanel' : 'layout.mobileRightPanel', panelKey);
      // This open NAMED its view, so it must not read as a header reveal: the
      // right drawer mounts fresh and compares its counter against `0`, so a
      // cleared counter is what says "nobody asked for a reveal here" — the
      // stored tab is what the drawer opens on. The left drawer stays mounted
      // and needs no reset: its counter only moves when the header asks.
      if (drawer === 'right') setRight(0);
      setCurrentScreen(drawer === 'left' ? 'session' : 'right');
    },
    [dock, sessionId, currentScreen, setCurrentScreen],
  );

  useKabmoEvent(OPEN_PANEL_EVENT, (event) => {
    const panelKey = (event as CustomEvent<OpenPanelDetail>).detail?.panelKey;
    if (panelKey) openNamedPanel(panelKey);
  });

  return { right, left, openSessionDrawer, openRightDrawer, openNamedPanel };
}
