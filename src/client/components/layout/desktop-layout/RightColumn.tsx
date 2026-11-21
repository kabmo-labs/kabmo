/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the right column draws, and the drop target that decides where a panel
 * dropped on it lands.
 *
 * Extracted from `WorkspacePanels` for the repository's per-file ceiling, and
 * it earns the boundary: the column's content is ONE renderer for two kinds of
 * view plus its own drop rule, while the panels around it own widths, the chat
 * and the editor.
 *
 * ## Two navigations over one body stack
 *
 * The body renderer is the same under both styles — that is what keeps a view
 * from behaving differently because of how it was chosen. What differs is WHICH
 * views are in the tree:
 *
 * - **`rail`** — every built-in view stays MOUNTED (hidden with CSS) so a tree's
 *   expansion, a search's results and a terminal's buffer survive a switch. That
 *   is what the rail has always done and it is why switching is instant.
 * - **`tabs`** — only the OPENED views are in the tree. A closed tab is a view
 *   the user finished with, and unmounting it is the point: a terminal stops
 *   polling, a search result set is released. Inside the open set the rule is
 *   unchanged — every tab stays mounted while another is on screen.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { ReactNode } from 'preact/compat';
import type { PanelImperativeHandle } from '@/client/components/layout/desktop-layout/resizer';
import { Panel } from '@/client/components/layout/desktop-layout/resizer';
import { PanelSuspense } from '@/client/components/layout/desktop-layout/PanelSuspense';
import { PluginPanelBody } from '@/client/components/workspace/plugin-panel/resolve';
import { PanelHostProvider } from '@kabmo-labs/kabmo-ui';
import type { PanelBodyProps } from '@/client/components/workspace/plugin-panel/resolve';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { PanelTabsColumn } from '@/client/components/workspace/panel-tabs';
import { usePanelDropTarget } from '@/client/hooks/workspace/panel-drop-target';
import { useLeftDock } from '@/client/hooks/workspace/left-dock';
import { usePanelTabs } from '@/client/hooks/workspace/panel-tabs';
import { useRevealEdge, useRevealPanelTab } from '@/client/hooks/workspace/panel-tabs-reveal';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { resolvePanelNav, type PanelNavStyle } from '@/shared/lib/workspace/panel-nav';

export interface RightColumnProps {
  panelRef: RefObject<PanelImperativeHandle | null>;
  open: boolean;
  width: number;
  minWidth: number;
  maxWidth: number | undefined;
  /** The catalog, in rail order: built-in views and installed plugin panels. */
  catalog: ResolvedPanel[];
  /** The view actually drawn — the stored id, or the column's first view. */
  shownPanel: string;
  /** The stored selection, which may name a panel this build cannot draw. */
  selectedPanel: string;
  activePanelFound: boolean;
  hasActiveContext: boolean;
  activeProjectPath?: string | null;
  refreshKey: number;
  onRefresh: () => void;
  /** A view's "open this file" hand-off; the host's own opener owns the path. */
  onOpenFile: (file: unknown) => void;
  onClose: () => void;
  /** How this column is navigated. `rail` when the setting is unreadable. */
  navStyle?: PanelNavStyle;
  /** Select a view from the tab strip; the host owns the stored selection. */
  onSelectPanel?: (id: string) => void;
  /**
   * An EXPLICIT request to open a view (`omp:open-panel` from a plugin's navbar
   * entry, a panel dropped on this column). The `nonce` makes two requests for
   * the same view two events.
   *
   * Deliberately separate from `shownPanel`: that value is the RESTORED
   * per-session selection, and in tabs mode the column's default is the home
   * page. Deriving a tab from it — which the first version did — made a fresh
   * install open `Files` on its own, because `DEFAULT_RIGHT_PANEL_TYPE` was
   * indistinguishable from a user's pick.
   */
  openRequest?: { panelKey: string; nonce: number } | null;
  /** The strip's trailing actions (refresh, collapse). */
  actions?: ReactNode;
}

export function RightColumn({
  panelRef,
  open,
  width,
  minWidth,
  maxWidth,
  catalog,
  shownPanel,
  selectedPanel,
  activePanelFound,
  hasActiveContext,
  activeProjectPath,
  refreshKey,
  onRefresh,
  onOpenFile,
  onClose,
  navStyle,
  onSelectPanel,
  openRequest,
  actions,
}: RightColumnProps) {
  // The right column is a destination too: a panel dragged from the left rail
  // must land where it was dropped, not bounce back because only the 44px rail
  // accepted it. The rail owns ordering; this owns which side receives it.
  const { setSide } = useLeftDock();
  const rightDrop = usePanelDropTarget({ onPlace: (id) => setSide(id, 'right') });
  const { sessionId } = useSessionStateContext();
  const style = resolvePanelNav(navStyle);
  const tabsMode = style === 'tabs';

  // Only read in `tabs` mode, and the hook is cheap: `known` is the catalog's
  // own ids, so a panel that is switched off or uninstalled drops out of a
  // stored tab instead of rendering an empty body.
  const known = new Set(catalog.map((panel) => panel.id));
  const tabsState = usePanelTabs('right', known, null);
  // A column REVEALED from the navbar's toggle (or `⌥⌘J`) must show a view, not
  // the catalog: the button's promise is "bring the panel back", and the home
  // page is a fresh session's empty state rather than something the click asked
  // for. The Stats readout, which names a panel, already opened one — this is
  // the same answer for the click that names no view. See `panel-tabs-reveal`.
  const revealed = useRevealEdge(open);
  useRevealPanelTab({
    enabled: tabsMode,
    revealed,
    view: shownPanel,
    home: tabsState.home,
    chosenHome: tabsState.chosenHome,
    openTab: tabsState.open,
    known,
  });
  // In tabs mode the OPEN set is the mounted set; under the rail it is the
  // whole catalog (minus plugins, which were never kept mounted).
  const openIds = new Set(tabsState.tabs);
  // The strip owns the selection in tabs mode, and the host's stored
  // `layout.activeRightPanel` follows it: other readers (the navbar readout, a
  // plugin's `omp:open-panel`) still resolve a view through that key, so it must
  // not keep naming a tab the user closed.
  // On the home page NO tab is on screen: falling back to `shownPanel` here
  // would mark a view active behind the catalog, and a view that re-reads on
  // activation would fetch for a page nobody is looking at.
  const effectivePanel = tabsMode ? (tabsState.home ? null : tabsState.active) : shownPanel;
  // Opening a tab from the home page happens through the strip, which writes the
  // hook; the effect above then mirrors it into the stored selection. `pinned`
  // is null here, so `active` is the user's own choice and may be `null`.
  useEffect(() => {
    if (!tabsMode || tabsState.home || tabsState.active === null) return;
    if (tabsState.active !== shownPanel) onSelectPanel?.(tabsState.active);
  }, [tabsMode, tabsState.home, tabsState.active, shownPanel, onSelectPanel]);

  /**
   * The OTHER direction, and it listens to a REQUEST rather than to
   * `shownPanel` — see `openRequest`. A restored selection is not an opening:
   * this column's default is the home page, so the only thing that may add a
   * tab without the user pressing something in the strip is a caller that
   * asked for a view by name.
   */
  const { open: openTab } = tabsState;
  /**
   * Each request is applied ONCE, tracked by its nonce.
   *
   * A plain effect on the key cannot do this job: `openTab`'s identity changes
   * with every tab write (it closes over the list), so the effect re-ran after
   * the user's own next action and forced the requested tab back open — closing
   * the last tab returned to home for one frame, and the strip then showed the
   * requested view again.
   */
  const appliedRequest = useRef<number | null>(null);
  const requestKey = openRequest?.panelKey;
  const requestNonce = openRequest?.nonce;
  useEffect(() => {
    if (!tabsMode || requestKey === undefined || requestNonce === undefined) return;
    if (appliedRequest.current === requestNonce) return;
    appliedRequest.current = requestNonce;
    // Only a view this column can DRAW becomes a tab: an id the catalog no
    // longer holds would be filtered straight back out and re-opened on the next
    // render, which is a write loop disguised as a sync.
    if (!known.has(requestKey)) return;
    openTab(requestKey);
  }, [tabsMode, requestKey, requestNonce, openTab, known]);

  const renderStack = () => (
    <PanelSuspense>
      {catalog.map((panel) => {
        const isActiveView = effectivePanel === panel.id;
        // A plugin panel is mounted only while it is the active one: a hidden
        // plugin is a component nobody is looking at, and the host owns no
        // state of its own to preserve. A CLOSED tab is the same answer for a
        // built-in view under the tab style.
        if (!panel.builtin && !isActiveView) return null;
        if (tabsMode && !openIds.has(panel.id)) return null;
        const body: PanelBodyProps = {
          className: 'w-full h-full',
          sessionId,
          // A view that stays live while hidden keeps reading even when another
          // view is on screen — the terminal owns a live PTY and swapping it to
          // the placeholder mid-command would drop the stream. Everything else
          // polls only while shown.
          enabled: panel.liveWhileHidden ? hasActiveContext : hasActiveContext && isActiveView,
          // On screen means selected AND the column is open. A collapsed right
          // panel keeps its views MOUNTED (that is what preserves a tree's
          // expansion and a terminal's buffer), so `isActiveView` alone would
          // report a view nobody can see as active — and a view that re-reads
          // on activation would never notice the column being reopened.
          active: isActiveView && open,
          refreshKey,
          ...(activeProjectPath ? { rootPath: activeProjectPath } : {}),
          onRefresh,
          onOpenFile,
          onClose,
          layout: 'desktop',
          tabsMode,
        };
        // `glass-chrome` + `data-panel-chrome` on the SLOT, not on each view:
        // the right panel is column chrome, exactly like the session sidebar,
        // and ten built-in views plus every plugin panel paint their own
        // `bg-paper` root. Marking the slot makes the column one surface and
        // leaves a future view nothing to forget.
        return (
          <div
            key={panel.id}
            data-panel-chrome=""
            className={`glass-chrome w-full h-full${isActiveView ? '' : ' hidden'}`}
          >
            <PanelHostProvider value={body}>{panel.render(body)}</PanelHostProvider>
          </div>
        );
      })}
      {/* The selection names a panel that is switched off, uninstalled, or
          whose bundle has not loaded — a notice, never a blank column. In tabs
          mode the home page IS the answer, so the notice is the rail's. */}
      {activePanelFound || (tabsMode && tabsState.home) ? null : (
        <div data-panel-chrome="" className="glass-chrome w-full h-full">
          <PluginPanelBody panelKey={selectedPanel} />
        </div>
      )}
    </PanelSuspense>
  );

  return (
    <Panel panelRef={panelRef} id="right-panel" defaultSize={width} minSize={minWidth} maxSize={maxWidth} collapsed={!open}>
      <div
        className={`w-full h-full ${rightDrop.active ? 'ring-1 ring-inset ring-ink/30' : ''}`}
        {...rightDrop.dropProps}
      >
        {tabsMode ? (
          <PanelTabsColumn
            catalog={catalog}
            /* The strip drives the HOOK, and the effect above mirrors the hook
               into the stored selection. Overriding `select` with
               `onSelectPanel` here — which is what the first version did — left
               the hook believing the old tab was still current, so a keyboard
               move focused the neighbour chip while the body stayed on the
               previous view. */
            tabs={tabsState}
            homeTitle="Panel kanan"
            {...(actions !== undefined ? { actions } : {})}
          >
            {renderStack()}
          </PanelTabsColumn>
        ) : (
          renderStack()
        )}
      </div>
    </Panel>
  );
}
