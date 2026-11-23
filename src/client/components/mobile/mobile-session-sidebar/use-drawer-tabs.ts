/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's LEFT drawer as a tab strip: its two-way mirror, its own gestures,
 * and the reveal a header press asks for.
 *
 * The mirror is the same rule `LeftColumn` runs for the desktop column — a view
 * chosen in the strip must reach the BODY, and a view chosen from outside it
 * (`omp:open-panel`, a restored selection) must appear as a CHIP. Skipping
 * either half is how a strip shows a chip over a body that is not it, or a body
 * with no chip at all.
 *
 * `ownGesture` exists because `layout.mobileLeftPanel` is TWO things at once: the
 * mirror of the strip's selection, and the slot an outside caller writes to ask
 * for a view. A close writes `active` to the neighbour while the mirror is one
 * render behind, so the seed effect read the just-closed id as a request and
 * reopened it — measured: closing `Files` left `['Sessions','Files']`. The flag
 * marks the commit that follows a gesture from the drawer, and the seed consumes
 * it and skips exactly that one.
 *
 * Extracted from `SessionSidebar` for the file ceiling: the drawer's dialogs,
 * footer and controller are the chrome, and this is the strip's state machine.
 */

import { useEffect, useRef } from 'preact/hooks';
import { useRevealPanelTab, useRevealSignal } from '@/client/hooks/workspace/panel-tabs-reveal';
import type { MobileDockState } from '@/client/components/mobile/mobile-session-sidebar/use-dock';
import type { PanelTabsHandle } from '@/client/hooks/workspace/panel-tabs';

export interface MobileDrawerTabs {
  /** The strip, with the drawer's own gestures marked. `null` outside tabs mode. */
  tabs: PanelTabsHandle | null;
}

export function useMobileDrawerTabs(dock: MobileDockState, revealSignal: number): MobileDrawerTabs {
  const tabs = dock.tabs;

  // The header's "Open Sessions" is a reveal: it must show the session list
  // rather than the drawer's catalog, exactly as the desktop sidebar's expand
  // control does. `dock.tabs` is `null` under `classic` (and with the rail off),
  // so it is passed as the writer and the hook stands down on its own — a hook
  // cannot be called conditionally.
  useRevealPanelTab({
    enabled: dock.tabsMode,
    revealed: useRevealSignal(revealSignal),
    // The left drawer pins the session list, so it always has a view to reveal.
    storedView: dock.activeView,
    home: tabs?.home ?? false,
    chosenHome: tabs?.chosenHome ?? false,
    openTab: tabs?.open ?? null,
    known: new Set(dock.catalog.map((panel) => panel.id)),
  });

  const ownGesture = useRef(false);
  const marked: PanelTabsHandle | null = tabs
    ? {
        ...tabs,
        select: (id: string) => {
          ownGesture.current = true;
          tabs.select(id);
        },
        open: (id: string) => {
          ownGesture.current = true;
          tabs.open(id);
        },
        close: (id: string) => {
          ownGesture.current = true;
          tabs.close(id);
        },
      }
    : null;

  useEffect(() => {
    if (!dock.tabsMode || !tabs) return;
    if (tabs.active !== null && tabs.active !== dock.activeView) dock.setActiveView(tabs.active);
  }, [dock.tabsMode, tabs?.active, dock.activeView, dock.setActiveView]);

  useEffect(() => {
    if (!dock.tabsMode || !tabs) return;
    // A commit the drawer made ITSELF is already the answer, not a request.
    if (ownGesture.current) {
      ownGesture.current = false;
      return;
    }
    if (tabs.tabs.includes(dock.activeView)) return;
    // Only a view this drawer can DRAW becomes a tab. Writing an id the catalog
    // no longer holds would be filtered straight back out and re-opened on the
    // next render — a write loop disguised as a sync.
    if (!dock.catalog.some((panel) => panel.id === dock.activeView)) return;
    tabs.open(dock.activeView);
  }, [dock.tabsMode, tabs, dock.activeView, dock.catalog]);

  return { tabs: marked };
}
